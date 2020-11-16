const { expect } = require("chai");
const c = require("../constants");
const abi = require("../abi.json");
const addresses = require("../addresses.json");
const { impersonateAccount, deployCErc20, deployCEther, deployComptroller } = require("../utils");
const USDC_ABI = require("../usdc_abi");
const BigNumber = hre.ethers.BigNumber;

let timelockSigner, new_pUSDC, old_pUSDC, comptroller, chainlinkPriceOracle,
    usdcMegaHolderSigner, usdc

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS);
  const {c1, _ } = await deployComptroller(timelockSigner);
  comptroller = c1;
  old_pUSDC = await hre.ethers.getContractAt("CTokenInterface", c.BRICKED_PUSDC_ADDRESS);
  new_pUSDC = await deployCErc20(c.USDC_ADDRESS, "Percent USDC", "pUSDC", await old_pUSDC.reserveFactorMantissa(), timelockSigner);
  old_pETH = await hre.ethers.getContractAt("CTokenInterface", c.BRICKED_PETH_ADDRESS);
  new_pETH = await deployCEther("Percent Ether", "pETH", await old_pETH.reserveFactorMantissa(), timelockSigner);
  old_pWBTC = await hre.ethers.getContractAt("CTokenInterface", c.BRICKED_PWBTC_ADDRESS);
  new_pWBTC = await deployCErc20(c.WBTC_ADDRESS, "Percent WBTC", "pWBTC", await old_pWBTC.reserveFactorMantissa(), timelockSigner);
  comptroller = await hre.ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, timelockSigner);
  chainlinkPriceOracle = await hre.ethers.getContractAt("ChainlinkPriceOracleProxy", c.CHAINLINK_PRICE_ORACLE_PROXY_ADDRESS, timelockSigner);
  await new_pUSDC.specialInitState(c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS);
  await new_pETH.specialInitState(c.BRICKED_PETH_ADDRESS, c.PETH_ACCOUNTS);
  await new_pWBTC.specialInitState(c.BRICKED_PWBTC_ADDRESS, c.PWBTC_ACCOUNTS);
  await chainlinkPriceOracle.setTokenConfigs(
      [new_pUSDC.address, new_pETH.address, new_pWBTC.address], 
      [c.USDC_CHAINLINK_AGGREGATOR_ADDRESS, c.ETH_CHAINLINK_AGGREGATOR_ADDRESS, c.WBTC_CHAINLINK_AGGREGATOR_ADDRESS], 
      [2,1,1],
      [6,18,8]);
  await comptroller._replaceMarket(new_pUSDC.address, c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS);
  await comptroller._replaceMarket(new_pETH.address, c.BRICKED_PETH_ADDRESS, c.PETH_ACCOUNTS);
  await comptroller._replaceMarket(new_pWBTC.address, c.BRICKED_PWBTC_ADDRESS, c.PWBTC_ACCOUNTS);
  usdcMegaHolderSigner = await impersonateAccount("0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8") // just an account with a lot of usdc (binance in this case)
  usdc = await hre.ethers.getContractAt(USDC_ABI, c.USDC_ADDRESS)
})

describe("Liquidate", function () {

    it("YFI lender can be liquidated if they don't repay their USDC", async function() {
        console.log("Close Factor", await comptroller.closeFactorMantissa() / 1e18);
        console.log("Liquidation Incentive", await comptroller.liquidationIncentiveMantissa() / 1e18);
        console.log("Seize Paused", await comptroller.seizeGuardianPaused());
        const pDAI_address = addresses.workingTokens[1].address;
        const pDAI = await hre.ethers.getContractAt(abi.CTOKEN_ABI, pDAI_address);
        const daiSnapshot = await pDAI.getAccountSnapshot(addresses.yfiLender);
        const Ten6 = (BigNumber.from("10")).pow(BigNumber.from("6"));
        const Ten18 = (BigNumber.from("10")).pow(BigNumber.from("18"));
        const daiBalance = daiSnapshot[1].mul(daiSnapshot[3]).div(Ten18);
        console.log("yfiLender pDAI Balance", await pDAI.balanceOf(addresses.yfiLender) / 1e8);
        console.log("yfiLender DAI Balance", daiBalance / 1e18);
        const usdcEquivalent = daiBalance.mul(Ten6).div(Ten18);
        const usdcSnapshot = await new_pUSDC.getAccountSnapshot(addresses.yfiLender);
        const usdcBorrows = usdcSnapshot[2];
        console.log("yfiLender USDC Borrows", usdcBorrows);
        await comptroller._setSeizePaused(false);
        console.log("Seize Paused", await comptroller.seizeGuardianPaused());
        await usdc.connect(usdcMegaHolderSigner).approve(
            new_pUSDC.address,
            usdcBorrows
        );
        await new_pUSDC.connect(usdcMegaHolderSigner).liquidateBorrow(
            addresses.yfiLender,
            usdcEquivalent,
            pDAI_address
        );
        const liqSnapshot = await pDAI.getAccountSnapshot("0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8");
        const liqBalance = liqSnapshot[1].mul(liqSnapshot[3]).div(Ten18);
        console.log(liqBalance);
    });
});