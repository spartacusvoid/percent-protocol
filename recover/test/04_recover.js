const { expect } = require("chai");
const c = require("../constants");
const abi = require("../abi");
const { impersonateAccount, redeem, repayEthLoan, repayUsdcLoan } = require("../utils");
const { ethers } = require("hardhat");
const USDC_ABI = require("../usdc_abi.json");

let multiSigSigner, comptroller, usdcMegaHolderSigner, usdc, chainlinkPriceOracle,
    new_pUSDC, new_pETH, new_pWBTC, old_pUSDC, old_pETH, old_pWBTC

before(async function () {
  multiSigSigner = await impersonateAccount(c.MULTISIG_ADDRESS);
  //Set various parameters
  /*
  await oldComptroller._setCloseFactor(BigNumber.from("900000000000000000")); //90% is the max
  await oldComptroller._setLiquidationIncentive(BigNumber.from("1000000000000000000")); //100%
  await oldComptroller._setTransferPaused(true);
*/
  old_pUSDC = await hre.ethers.getContractAt(abi.OLD_PETH_ABI, c.BRICKED_PUSDC_ADDRESS);
  old_pETH = await hre.ethers.getContractAt(abi.OLD_PETH_ABI, c.BRICKED_PETH_ADDRESS);
  old_pWBTC = await hre.ethers.getContractAt(abi.OLD_PETH_ABI, c.BRICKED_PWBTC_ADDRESS);

  new_pUSDC = await hre.ethers.getContractAt("InsolventCErc20", c.NEW_PUSDC_ADDRESS);
  new_pETH = await hre.ethers.getContractAt("InsolventCEther", c.NEW_PETH_ADDRESS);
  new_pWBTC = await hre.ethers.getContractAt("InsolventCErc20", c.NEW_PWBTC_ADDRESS);

  comptroller = await ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, multiSigSigner);

  chainlinkPriceOracle = await ethers.getContractAt("ChainlinkPriceOracleProxy", c.CHAINLINK_PRICE_ORACLE_PROXY_ADDRESS);
  //Replace the 3 markets on Comptroller
  console.log("Replacing USDC market");
  await comptroller._replaceMarket(c.NEW_PUSDC_ADDRESS, c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS);         //Tx 7
  console.log("Replacing ETH market");
  await comptroller._replaceMarket(c.NEW_PETH_ADDRESS, c.BRICKED_PETH_ADDRESS, c.PETH_ACCOUNTS);            //Tx 8
  console.log("Replacing wBTC market");
  await comptroller._replaceMarket(c.NEW_PWBTC_ADDRESS, c.BRICKED_PWBTC_ADDRESS, c.PWBTC_ACCOUNTS);         //Tx 9
  console.log("Markets replaced");
  usdcMegaHolderSigner = await impersonateAccount("0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8") // just an account with a lot of usdc (binance in this case)
  usdc = await ethers.getContractAt(USDC_ABI, c.USDC_ADDRESS)
});

describe('Deployment', function () {
  it('Should have the correct reserve factors', async function () {
    expect(await new_pUSDC.reserveFactorMantissa() / 1e18).to.equal(await old_pUSDC.reserveFactorMantissa() / 1e18);
    expect(await new_pWBTC.reserveFactorMantissa() / 1e18).to.equal(await old_pWBTC.reserveFactorMantissa() / 1e18);
    expect(await old_pETH.reserveFactorMantissa() / 1e18).to.equal(await new_pETH.reserveFactorMantissa() / 1e18);
  });

  it('Should call accrueInterest', async function () {
    await new_pETH.accrueInterest();
    await new_pUSDC.accrueInterest();
    await new_pWBTC.accrueInterest();
  });

  it("Can replace ETH market in comptroller", async function(){  
    const newMarket = await comptroller.markets(c.NEW_PETH_ADDRESS)
    const oldMarket = await comptroller.markets(c.BRICKED_PETH_ADDRESS)

    expect(newMarket.isListed).to.be.true
    expect(oldMarket.isListed).to.be.false

    expect(await comptroller.mintGuardianPaused(c.NEW_PETH_ADDRESS)).to.be.true
    expect(await comptroller.borrowGuardianPaused(c.NEW_PETH_ADDRESS)).to.be.true
  })

  it("Can replace USDC market in comptroller", async function(){
      const newMarket = await comptroller.markets(c.NEW_PUSDC_ADDRESS);
      const oldMarket = await comptroller.markets(c.BRICKED_PUSDC_ADDRESS);

      expect(newMarket.isListed).to.be.true;
      expect(oldMarket.isListed).to.be.false;

      expect(await comptroller.mintGuardianPaused(c.NEW_PUSDC_ADDRESS)).to.be.true;
      expect(await comptroller.borrowGuardianPaused(c.NEW_PUSDC_ADDRESS)).to.be.true;
  });

  it("Can replace WBTC market in comptroller", async function(){
      const newMarket = await comptroller.markets(c.NEW_PWBTC_ADDRESS);
      const oldMarket = await comptroller.markets(c.BRICKED_PWBTC_ADDRESS);

      expect(newMarket.isListed).to.be.true;
      expect(oldMarket.isListed).to.be.false;

      expect(await comptroller.mintGuardianPaused(c.NEW_PWBTC_ADDRESS)).to.be.true;
      expect(await comptroller.borrowGuardianPaused(c.NEW_PWBTC_ADDRESS)).to.be.true;
  });
    
  it("USDC Repaid funds can be redeemed by suppliers", async function() {
      const totalUnderlyingStart = await usdc.balanceOf(c.NEW_PUSDC_ADDRESS) / 1e6;
      console.log("START total underlying usdc: ", totalUnderlyingStart);
      const usdcPrice =await chainlinkPriceOracle.getUnderlyingPrice(c.NEW_PUSDC_ADDRESS) / 1e30;
      console.log(`Chainlink oracle price: $${usdcPrice}`); 

      await Promise.all(c.PUSDC_ACCOUNTS.map(x => repayUsdcLoan(x, usdc, usdcMegaHolderSigner, new_pUSDC)));
      const totalUnderlyingRepay = await usdc.balanceOf(c.NEW_PUSDC_ADDRESS) / 1e6;
      console.log("REPAY total underlying usdc: ", totalUnderlyingRepay)
      await Promise.all(c.PUSDC_ACCOUNTS.map(x => redeem(new_pUSDC, x)));
      const totalUnderlyingEnd = await usdc.balanceOf(c.NEW_PUSDC_ADDRESS) / 1e6;
      console.log("END total underlying usdc: ", totalUnderlyingEnd)
  });

  it("ETH Repaid funds can be redeemed by suppliers", async function() {
      const totalUnderlyingStart = await hre.ethers.provider.getBalance(c.NEW_PETH_ADDRESS) / 1e18;
      console.log("START total underlying ETH: ", totalUnderlyingStart);
      const ethPrice =await chainlinkPriceOracle.getUnderlyingPrice(c.NEW_PETH_ADDRESS) / 1e18;
      console.log(`Chainlink oracle price: $${ethPrice}`); 

      await Promise.all(c.PETH_ACCOUNTS.map(x => repayEthLoan(x, new_pETH)));
      const totalUnderlyingRepay = await hre.ethers.provider.getBalance(c.NEW_PETH_ADDRESS) / 1e18;
      console.log("REPAY total underlying ETH: ", totalUnderlyingRepay)
      await Promise.all(c.PETH_ACCOUNTS.map(x => redeem(new_pETH, x)));
      const totalUnderlyingEnd = await hre.ethers.provider.getBalance(c.NEW_PETH_ADDRESS) / 1e18;
      console.log("END total underlying ETH: ", totalUnderlyingEnd)
  });

  it("New wBTC has no balance, no supply and no borrows", async function() {
      const totalUnderlyingStart = await usdc.balanceOf(c.NEW_PWBTC_ADDRESS) / 1e8;
      expect(totalUnderlyingStart).to.equal(0);
      const totalSupply = await new_pWBTC.totalSupply() / 1e8;
      expect(totalSupply).to.equal(0);
      const totalBorrows = await new_pWBTC.totalBorrows() / 1e8;
      expect(totalBorrows).to.equal(0);
  })
});