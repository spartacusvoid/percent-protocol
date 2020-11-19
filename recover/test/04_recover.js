
const { expect } = require("chai");
const c = require("../constants");
const abi = require("../abi");
const addresses = require("../addresses.json");
const { impersonateAccount, redeem, repayEthLoan, repayUsdcLoan } = require("../utils");
const { deployments, ethers } = require("hardhat");
const BigNumber = hre.ethers.BigNumber;
const USDC_ABI = require("../usdc_abi.json");
const { NEW_PWBTC_ADDRESS } = require("../constants");

let timelockSigner, multiSigSigner,
    new_pUSDC, old_pUSDC, new_pETH, old_pETH, new_pWBTC, old_pWBTC,
    comptroller, chainlinkPriceOracle,
    usdcMegaHolderSigner, usdc

before(async function () {
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS);
  multiSigSigner = await impersonateAccount(c.MULTISIG_ADDRESS);

  const unitroller = await ethers.getContractAt("Unitroller", c.UNITROLLER_ADDRESS, timelockSigner);
  old_pWBTC = await ethers.getContractAt(abi.CTOKEN_ABI, c.BRICKED_PWBTC_ADDRESS);
  old_pUSDC = await ethers.getContractAt(abi.CTOKEN_ABI, c.BRICKED_PUSDC_ADDRESS);
  old_pETH = await ethers.getContractAt(abi.CTOKEN_ABI, c.BRICKED_PETH_ADDRESS);
  const oldComptroller = await ethers.getContractAt("Comptroller", c.UNITROLLER_ADDRESS, multiSigSigner);
  chainlinkPriceOracle = await ethers.getContractAt("ChainlinkPriceOracleProxy", c.CHAINLINK_PRICE_ORACLE_PROXY_ADDRESS, timelockSigner);

  //Phase A

  //Change unitroller and chainlink admin to multisig
  await unitroller._setPendingAdmin(c.MULTISIG_ADDRESS);
  await unitroller.connect(multiSigSigner)._acceptAdmin();
  await chainlinkPriceOracle.transferOwnership(c.MULTISIG_ADDRESS);

  //Set various parameters
  await oldComptroller._setCloseFactor(BigNumber.from("900000000000000000")); //90% is the max
  await oldComptroller._setLiquidationIncentive(BigNumber.from("1000000000000000000")); //100%
  await oldComptroller._setSeizePaused(true);
  await oldComptroller._setTransferPaused(true);

  //Phase B

  //Deploys Comptroller in deploy_script.ts
  //Comptroller
  await deployments.fixture();
  
  //Phase C

  console.log("Changing implementation");
  //Transfer unitroller to new implementation
  const comptrollerReplacement = await ethers.getContract('InsolventComptroller');
  await unitroller.connect(multiSigSigner)._setPendingImplementation(comptrollerReplacement.address);     //Tx 1
  await comptrollerReplacement.connect(multiSigSigner)._become(c.UNITROLLER_ADDRESS);
  comptroller = await ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, multiSigSigner); //Tx 2

  new_pUSDC = await ethers.getContractAt("InsolventCErc20", c.NEW_PUSDC_ADDRESS, multiSigSigner);
  new_pWBTC = await ethers.getContractAt("InsolventCErc20", c.NEW_PWBTC_ADDRESS, multiSigSigner);
  new_pETH = await ethers.getContractAt('InsolventCEther', c.NEW_PETH_ADDRESS, multiSigSigner);

  console.log("Initializing token state");
  //Set reserve factors and apply the haircut
  await new_pUSDC._specialInitState(c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS);                           //Tx 3
  await new_pETH._specialInitState(c.BRICKED_PETH_ADDRESS, c.PETH_ACCOUNTS);                              //Tx 4
  await new_pWBTC._specialInitState(c.BRICKED_PWBTC_ADDRESS, c.PWBTC_ACCOUNTS);                           //Tx 5

  //Configure the price oracle for the 3 new tokens
  console.log("Setting Chainlink token configs");
  await chainlinkPriceOracle.connect(multiSigSigner).setTokenConfigs(                                     //Tx 6
      [new_pUSDC.address, new_pETH.address, new_pWBTC.address], 
      [c.USDC_CHAINLINK_AGGREGATOR_ADDRESS, c.ETH_CHAINLINK_AGGREGATOR_ADDRESS, c.WBTC_CHAINLINK_AGGREGATOR_ADDRESS], 
      [2,1,1],
      [6,18,8]);

  //Replace the 3 markets on Comptroller
  console.log("Replacing USDC market");
  await comptroller._replaceMarket(new_pUSDC.address, c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS);         //Tx 7
  console.log("Replacing ETH market");
  await comptroller._replaceMarket(new_pETH.address, c.BRICKED_PETH_ADDRESS, c.PETH_ACCOUNTS);            //Tx 8
  console.log("Replacing wBTC market");
  await comptroller._replaceMarket(new_pWBTC.address, c.BRICKED_PWBTC_ADDRESS, c.PWBTC_ACCOUNTS);         //Tx 9
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