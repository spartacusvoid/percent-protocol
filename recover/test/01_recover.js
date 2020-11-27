const { expect } = require("chai");
const c = require("../constants");
const abi = require("../abi");
const { impersonateAccount } = require("../utils");
const { ethers } = require("hardhat");
const USDC_ABI = require("../usdc_abi.json");

let multiSigSigner, timelockSigner, vfatSigner, comptroller, chainlinkPriceOracle,
    new_pUSDC, new_pYFI, old_pUSDC, old_pYFI

before(async function () {
  multiSigSigner = await impersonateAccount(c.MULTISIG_ADDRESS);
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS);
  vfatSigner     = await impersonateAccount(c.VFAT_ADDRESS);
  await deployments.fixture();

  old_pUSDC = await hre.ethers.getContractAt("InsolventCErc20", c.NEW_PUSDC_ADDRESS);
  old_pYFI =  await hre.ethers.getContractAt("InsolventCErc20", c.OLD_PYFI_ADDRESS);
  old_pUSDT = await hre.ethers.getContractAt("InsolventCErc20", c.OLD_PUSDT_ADDRESS);
  old_pDAI =  await hre.ethers.getContractAt("InsolventCErc20", c.OLD_PDAI_ADDRESS);

  new_pUSDC = await hre.ethers.getContractAt("InsolventCErc20", c.NEW_NEW_PUSDC_ADDRESS);
  new_pYFI =  await hre.ethers.getContractAt("InsolventCErc20", c.NEW_PYFI_ADDRESS);
  new_pUSDT = await hre.ethers.getContractAt("InsolventCErc20", c.NEW_PUSDT_ADDRESS);
  new_pDAI =  await hre.ethers.getContractAt("InsolventCErc20", c.NEW_PDAI_ADDRESS);

  const unitroller = await ethers.getContractAt("Unitroller", c.UNITROLLER_ADDRESS, multiSigSigner);
  
  //const comptrollerReplacement = await ethers.getContract("InsolventComptroller2");
  const comptrollerReplacement = await ethers.getContractAt('InsolventComptroller2', c.NEW_NEW_COMPTROLLER_ADDRESS, vfatSigner);
  await unitroller._setPendingImplementation(comptrollerReplacement.address); 
  await comptrollerReplacement.connect(multiSigSigner)._become(c.UNITROLLER_ADDRESS);
  comptroller = await ethers.getContractAt("InsolventComptroller2", c.UNITROLLER_ADDRESS, multiSigSigner); 

  chainlinkPriceOracle = await ethers.getContractAt("ChainlinkPriceOracleProxy", c.CHAINLINK_PRICE_ORACLE_PROXY_ADDRESS);
  //Configure the price oracle for the 2 new tokens
  console.log("Setting Chainlink token configs");
  await chainlinkPriceOracle.connect(timelockSigner).setTokenConfigs(                                   
      [new_pUSDC.address, new_pYFI.address, new_pUSDT.address, new_pDAI.address], 
      [c.USDC_CHAINLINK_AGGREGATOR_ADDRESS, c.YFI_CHAINLINK_AGGREGATOR_ADDRESS, c.USDT_CHAINLINK_AGGREGATOR_ADDRESS, c.DAI_CHAINLINK_AGGREGATOR_ADDRESS], 
      [2,2,2,1],
      [6,18,6,18]);

  //Set reserve factors
  await  new_pYFI.connect(multiSigSigner)._setReserveFactor(await  old_pYFI.reserveFactorMantissa());
  await new_pUSDC.connect(multiSigSigner)._setReserveFactor(await old_pUSDC.reserveFactorMantissa());
  await new_pUSDT.connect(multiSigSigner)._setReserveFactor(await old_pUSDT.reserveFactorMantissa());
  await  new_pDAI.connect(multiSigSigner)._setReserveFactor(await  old_pDAI.reserveFactorMantissa());

  //Replace the 2 markets on Comptroller
  console.log("Replacing USDC market");
  await comptroller._replaceMarket(new_pUSDC.address, old_pUSDC.address, c.PUSDC_ACCOUNTS); 
  console.log("Replacing YFI market");
  await comptroller._replaceMarket(new_pYFI.address, old_pYFI.address, c.PYFI_ACCOUNTS);
  console.log("Replacing USDT market");
  await comptroller._replaceMarket(new_pUSDT.address, old_pUSDT.address, c.PUSDT_ACCOUNTS);
  console.log("Replacing DAI market");
  await comptroller._replaceMarket(new_pDAI.address, old_pDAI.address, c.PDAI_ACCOUNTS);
});

describe('Deployment', function () {
  it('Should have the correct reserve factors', async function () {
    expect(await  new_pYFI.reserveFactorMantissa() / 1e18).to.equal(await  old_pYFI.reserveFactorMantissa() / 1e18);
    expect(await new_pUSDC.reserveFactorMantissa() / 1e18).to.equal(await old_pUSDC.reserveFactorMantissa() / 1e18);
    expect(await new_pUSDT.reserveFactorMantissa() / 1e18).to.equal(await old_pUSDT.reserveFactorMantissa() / 1e18);
    expect(await  new_pDAI.reserveFactorMantissa() / 1e18).to.equal(await  old_pDAI.reserveFactorMantissa() / 1e18);
  });

  it('Should call accrueInterest', async function () {
    await new_pUSDC.accrueInterest();
    await new_pYFI.accrueInterest();
    await new_pUSDT.accrueInterest();
    await new_pDAI.accrueInterest();
  });

  it("Can replace YFI market in comptroller", async function(){  
    const newMarket = await comptroller.markets(new_pYFI.address);
    const oldMarket = await comptroller.markets(old_pYFI.address);

    expect(newMarket.isListed).to.be.true;
    expect(oldMarket.isListed).to.be.false;

    expect(await comptroller.mintGuardianPaused(new_pYFI.address)).to.be.true;
    expect(await comptroller.borrowGuardianPaused(new_pYFI.address)).to.be.true;
  })

  it("Can replace USDC market in comptroller", async function(){
      const newMarket = await comptroller.markets(new_pUSDC.address);
      const oldMarket = await comptroller.markets(old_pUSDC.address);

      expect(newMarket.isListed).to.be.true;
      expect(oldMarket.isListed).to.be.false;

      expect(await comptroller.mintGuardianPaused(new_pUSDC.address)).to.be.true;
      expect(await comptroller.borrowGuardianPaused(new_pUSDC.address)).to.be.true;
  });

  it("Can replace USDT market in comptroller", async function(){
      const newMarket = await comptroller.markets(new_pUSDT.address);
      const oldMarket = await comptroller.markets(old_pUSDT.address);

      expect(newMarket.isListed).to.be.true;
      expect(oldMarket.isListed).to.be.false;

      expect(await comptroller.mintGuardianPaused(new_pUSDT.address)).to.be.true;
      expect(await comptroller.borrowGuardianPaused(new_pUSDT.address)).to.be.true;
  });

  it("Can replace DAI market in comptroller", async function(){
      const newMarket = await comptroller.markets(new_pDAI.address);
      const oldMarket = await comptroller.markets(old_pDAI.address);

      expect(newMarket.isListed).to.be.true;
      expect(oldMarket.isListed).to.be.false;

      expect(await comptroller.mintGuardianPaused(new_pDAI.address)).to.be.true;
      expect(await comptroller.borrowGuardianPaused(new_pDAI.address)).to.be.true;
  });

  it("New YFI has no balance, no supply and no borrows", async function() {
      const underlyingAddress = await new_pYFI.underlying();
      const underlying = await ethers.getContractAt(USDC_ABI, underlyingAddress);
      const totalUnderlyingStart = await underlying.balanceOf(new_pYFI.address) / 1e8;
      expect(totalUnderlyingStart).to.equal(0);
      const totalSupply = await new_pYFI.totalSupply() / 1e8;
      expect(totalSupply).to.equal(0);
      const totalBorrows = await new_pYFI.totalBorrows() / 1e8;
      expect(totalBorrows).to.equal(0);
  });

  it("New USDC has no balance, no supply and no borrows", async function() {
      const underlyingAddress = await new_pUSDC.underlying();
      const underlying = await ethers.getContractAt(USDC_ABI, underlyingAddress);
      const totalUnderlyingStart = await underlying.balanceOf(new_pUSDC.address) / 1e8;
      expect(totalUnderlyingStart).to.equal(0);
      const totalSupply = await new_pUSDC.totalSupply() / 1e8;
      expect(totalSupply).to.equal(0);
      const totalBorrows = await new_pUSDC.totalBorrows() / 1e8;
      expect(totalBorrows).to.equal(0);
  });

  it("New USDT has no balance, no supply and no borrows", async function() {
      const underlyingAddress = await new_pUSDT.underlying();
      const underlying = await ethers.getContractAt(USDC_ABI, underlyingAddress);
      const totalUnderlyingStart = await underlying.balanceOf(new_pUSDT.address) / 1e8;
      expect(totalUnderlyingStart).to.equal(0);
      const totalSupply = await new_pUSDT.totalSupply() / 1e8;
      expect(totalSupply).to.equal(0);
      const totalBorrows = await new_pUSDT.totalBorrows() / 1e8;
      expect(totalBorrows).to.equal(0);
  });

  it("New DAI has no balance, no supply and no borrows", async function() {
      const underlyingAddress = await new_pDAI.underlying();
      const underlying = await ethers.getContractAt(USDC_ABI, underlyingAddress);
      const totalUnderlyingStart = await underlying.balanceOf(new_pDAI.address) / 1e8;
      expect(totalUnderlyingStart).to.equal(0);
      const totalSupply = await new_pDAI.totalSupply() / 1e8;
      expect(totalSupply).to.equal(0);
      const totalBorrows = await new_pDAI.totalBorrows() / 1e8;
      expect(totalBorrows).to.equal(0);
  });

  it("Can retrieve prices for the new assets", async function() {
      const usdcPrice = await chainlinkPriceOracle.getUnderlyingPrice(new_pUSDC.address);
      const yfiPrice = await chainlinkPriceOracle.getUnderlyingPrice(new_pYFI.address);
      const usdtPrice = await chainlinkPriceOracle.getUnderlyingPrice(new_pUSDT.address);
      const daiPrice = await chainlinkPriceOracle.getUnderlyingPrice(new_pDAI.address);
      //Mantissa = 36 - decimals, USDC and USDT have 6 decimals, DAI and YFI have 18
      expect(usdcPrice / 1e30).to.be.closeTo(1, 0.05, "USDC");
      expect(usdtPrice / 1e30).to.be.closeTo(1, 0.05, "USDT");
      expect(daiPrice / 1e18).to.be.closeTo(1, 0.05, "DAI");
      expect(yfiPrice / 1e18).to.be.within(10000, 50000, "YFI");
  });

  it("Account 0xD9B99266C42d427Bb3A64f30a0242bbEb41F6830 should not have the old markets", async function() {
    const assetsIn = await comptroller.getAssetsIn("0xD9B99266C42d427Bb3A64f30a0242bbEb41F6830");
    expect(assetsIn).to.not.include(c.NEW_PUSDC_ADDRESS);
    expect(assetsIn).to.not.include(c.OLD_PYFI_ADDRESS);
    expect(assetsIn).to.not.include(c.OLD_PYFI_ADDRESS);
  });

  it("There are no insolvent accounts after swapping the markets", async function() {
    for (const a of c.PUSDC_ACCOUNTS) {
      const snapshot = await comptroller.getAccountLiquidity(a);
      expect(snapshot[2] / 1e18).to.be.lessThan(50, a);
    }
  })
});