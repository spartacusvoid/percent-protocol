
const { expect } = require("chai");
const c = require("../constants");
const abi = require("../abi");
const addresses = require("../addresses.json");
const { impersonateAccount, redeem, repayEthLoan, repayUsdcLoan } = require("../utils");
const { deployments } = require("hardhat");
const BigNumber = hre.ethers.BigNumber;
const USDC_ABI = require("../usdc_abi.json");

let timelockSigner, multiSigSigner,
    new_pUSDC, old_pUSDC, new_pETH, old_pETH, new_pWBTC, old_pWBTC,
    comptroller, chainlinkPriceOracle,
    usdcMegaHolderSigner, usdc

before(async function () {
  await deployments.fixture();
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS);
  multiSigSigner = await impersonateAccount(c.MULTISIG_ADDRESS);
  const comptrollerReplacement = await ethers.getContract('InsolventComptroller');
  const unitroller = await ethers.getContractAt("Unitroller", c.UNITROLLER_ADDRESS, timelockSigner);
  await unitroller._setPendingAdmin(c.MULTISIG_ADDRESS);
  await unitroller.connect(multiSigSigner)._acceptAdmin();
  chainlinkPriceOracle = await ethers.getContractAt("ChainlinkPriceOracleProxy", c.CHAINLINK_PRICE_ORACLE_PROXY_ADDRESS, timelockSigner);
  await chainlinkPriceOracle.transferOwnership(c.MULTISIG_ADDRESS);
  console.log("Changing implementation");
  await unitroller.connect(multiSigSigner)._setPendingImplementation(comptrollerReplacement.address);
  await comptrollerReplacement.connect(multiSigSigner)._become(c.UNITROLLER_ADDRESS);
  comptroller = await ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, multiSigSigner);
  console.log("Setting comptroller parameters");
  await comptroller._setCloseFactor(BigNumber.from("900000000000000000")); //90% is the max
  await comptroller._setLiquidationIncentive(BigNumber.from("1000000000000000000")); //100%
  await comptroller._setSeizePaused(true);
  await comptroller._setTransferPaused(true);
  let new_pUSDC_address = (await ethers.getContract('pUSDC')).address
  new_pUSDC = await ethers.getContractAt("InsolventCErc20", new_pUSDC_address, multiSigSigner);
  old_pUSDC = await ethers.getContractAt(abi.CTOKEN_ABI, c.BRICKED_PUSDC_ADDRESS);
  await new_pUSDC._setReserveFactor(await old_pUSDC.reserveFactorMantissa());
  let new_pWBTC_address = (await ethers.getContract('pWBTC')).address
  new_pWBTC = await ethers.getContractAt("InsolventCErc20", new_pWBTC_address, multiSigSigner);
  old_pWBTC = await ethers.getContractAt(abi.CTOKEN_ABI, c.BRICKED_PWBTC_ADDRESS);
  await new_pWBTC._setReserveFactor(await old_pWBTC.reserveFactorMantissa());
  new_pETH = await ethers.getContract('pETH', multiSigSigner);
  old_pETH = await ethers.getContractAt(abi.CTOKEN_ABI, c.BRICKED_PETH_ADDRESS);
  await new_pETH._setReserveFactor(await old_pETH.reserveFactorMantissa());
  console.log("Initializing token state");
  await new_pUSDC._specialInitState(c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS);
  await new_pETH._specialInitState(c.BRICKED_PETH_ADDRESS, c.PETH_ACCOUNTS);
  await new_pWBTC._specialInitState(c.BRICKED_PWBTC_ADDRESS, c.PWBTC_ACCOUNTS);
  console.log("Setting Chainlink token configs");
  await chainlinkPriceOracle.connect(multiSigSigner).setTokenConfigs(
      [new_pUSDC.address, new_pETH.address, new_pWBTC.address], 
      [c.USDC_CHAINLINK_AGGREGATOR_ADDRESS, c.ETH_CHAINLINK_AGGREGATOR_ADDRESS, c.WBTC_CHAINLINK_AGGREGATOR_ADDRESS], 
      [2,1,1],
      [6,18,8]);
  console.log("Replacing comptroller markets");
  await comptroller._replaceMarket(new_pUSDC.address, c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS);
  await comptroller._replaceMarket(new_pETH.address, c.BRICKED_PETH_ADDRESS, c.PETH_ACCOUNTS);
  await comptroller._replaceMarket(new_pWBTC.address, c.BRICKED_PWBTC_ADDRESS, c.PWBTC_ACCOUNTS);
  console.log("Markets replaced");
  usdcMegaHolderSigner = await impersonateAccount("0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8") // just an account with a lot of usdc (binance in this case)
  usdc = await ethers.getContractAt(USDC_ABI, c.USDC_ADDRESS)
});

describe('Deployment', function () {
  it('pUSDC should have the correct reserve factor', async function () {
    expect(await new_pUSDC.reserveFactorMantissa() / 1e18).to.equal(await old_pUSDC.reserveFactorMantissa() / 1e18);
  });

  it('pWBTC should have the correct reserve factor', async function () {
    expect(await new_pWBTC.reserveFactorMantissa() / 1e18).to.equal(await old_pWBTC.reserveFactorMantissa() / 1e18);
  });

  it('pETH should have the correct reserve factor', async function () {
    expect(await old_pETH.reserveFactorMantissa() / 1e18).to.equal(await new_pETH.reserveFactorMantissa() / 1e18);
  });

  it("Can replace ETH market in comptroller", async function(){  
    const newMarket = await comptroller.markets(new_pETH.address)
    const oldMarket = await comptroller.markets(c.BRICKED_PETH_ADDRESS)

    expect(newMarket.isListed).to.be.true
    expect(oldMarket.isListed).to.be.false

    expect(await comptroller.mintGuardianPaused(new_pETH.address)).to.be.true
    expect(await comptroller.borrowGuardianPaused(new_pETH.address)).to.be.true
  })

  it("Can replace USDC market in comptroller", async function(){
      const newMarket = await comptroller.markets(new_pUSDC.address);
      const oldMarket = await comptroller.markets(c.BRICKED_PUSDC_ADDRESS);

      expect(newMarket.isListed).to.be.true;
      expect(oldMarket.isListed).to.be.false;

      expect(await comptroller.mintGuardianPaused(new_pUSDC.address)).to.be.true;
      expect(await comptroller.borrowGuardianPaused(new_pUSDC.address)).to.be.true;
  });

  it("Can replace WBTC market in comptroller", async function(){
      const newMarket = await comptroller.markets(new_pWBTC.address);
      const oldMarket = await comptroller.markets(c.BRICKED_PWBTC_ADDRESS);

      expect(newMarket.isListed).to.be.true;
      expect(oldMarket.isListed).to.be.false;

      expect(await comptroller.mintGuardianPaused(new_pWBTC.address)).to.be.true;
      expect(await comptroller.borrowGuardianPaused(new_pWBTC.address)).to.be.true;
  });

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
        const liqBalance = liqSnapshot[1].mul(liqSnapshot[3]).div(Ten18) / 1e18;
        console.log(liqBalance);
        expect(liqBalance).to.be.greaterThan(280000);
    });
    
  it("USDC Repaid funds can be redeemed by suppliers", async function() {
      const totalUnderlyingStart = await usdc.balanceOf(new_pUSDC.address) / 1e6;
      console.log("START total underlying usdc: ", totalUnderlyingStart);
      const usdcPrice =await chainlinkPriceOracle.getUnderlyingPrice(new_pUSDC.address) / 1e30;
      console.log(`Chainlink oracle price: $${usdcPrice}`); 

      await Promise.all(c.PUSDC_ACCOUNTS.map(x => repayUsdcLoan(x, usdc, usdcMegaHolderSigner, new_pUSDC)));
      const totalUnderlyingRepay = await usdc.balanceOf(new_pUSDC.address) / 1e6;
      console.log("REPAY total underlying usdc: ", totalUnderlyingRepay)
      await Promise.all(c.PUSDC_ACCOUNTS.map(x => redeem(new_pUSDC, x)));
      const totalUnderlyingEnd = await usdc.balanceOf(new_pUSDC.address) / 1e6;
      console.log("END total underlying usdc: ", totalUnderlyingEnd)
  });

  it("ETH Repaid funds can be redeemed by suppliers", async function() {
      const totalUnderlyingStart = await hre.ethers.provider.getBalance(new_pETH.address) / 1e18;
      console.log("START total underlying ETH: ", totalUnderlyingStart);
      const ethPrice =await chainlinkPriceOracle.getUnderlyingPrice(new_pETH.address) / 1e18;
      console.log(`Chainlink oracle price: $${ethPrice}`); 

      await Promise.all(c.PETH_ACCOUNTS.map(x => repayEthLoan(x, new_pETH)));
      const totalUnderlyingRepay = await hre.ethers.provider.getBalance(new_pETH.address) / 1e18;
      console.log("REPAY total underlying ETH: ", totalUnderlyingRepay)
      await Promise.all(c.PETH_ACCOUNTS.map(x => redeem(new_pETH, x)));
      const totalUnderlyingEnd = await hre.ethers.provider.getBalance(new_pETH.address) / 1e18;
      console.log("END total underlying ETH: ", totalUnderlyingEnd)
  });

  it("New wBTC has no balance, no supply and no borrows", async function() {
      const totalUnderlyingStart = await usdc.balanceOf(new_pWBTC.address) / 1e8;
      expect(totalUnderlyingStart).to.equal(0);
      const totalSupply = await new_pWBTC.totalSupply() / 1e8;
      expect(totalSupply).to.equal(0);
      const totalBorrows = await new_pWBTC.totalBorrows() / 1e8;
      expect(totalBorrows).to.equal(0);
  })
});