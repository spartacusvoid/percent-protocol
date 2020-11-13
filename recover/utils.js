const hre = require("hardhat");
const ethers = hre.ethers;
const c = require("./constants");
const { BigNumber } = ethers;

const impersonateAccount = async address => {
  const [account1] = await ethers.getSigners()
  await account1.sendTransaction({to: address, value: ethers.utils.parseEther("1.0")})
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address]
  })
  return await ethers.provider.getSigner(address)
}

const deployInsolventCErc20Delegate = async (adminSigner) => {
  const InsolventCErc20Delegate = await hre.ethers.getContractFactory("InsolventCErc20Delegate", adminSigner);
  const insolventCErc20Delegate = await InsolventCErc20Delegate.deploy();
  await insolventCErc20Delegate.deployed();
  return insolventCErc20Delegate
}

const deployCErc20 = async (underlying, name, symbol, reserveFactor, adminSigner) => {
  const insolventCErc20Delegate = await deployInsolventCErc20Delegate(adminSigner)
  const InsolventCErc20Delegator = await hre.ethers.getContractFactory("CErc20Delegator", adminSigner);
  const adminAddress = await adminSigner.getAddress()
  const cErc20Delegator = await InsolventCErc20Delegator.deploy(
    underlying,                          // underlying_
    c.UNITROLLER_ADDRESS,                  // comptroller_
    c.INTEREST_RATE_MODEL_ADDRESS,         // interestRateModel_
    c.INITIAL_EXCHANGE_RATE_MANTISSA,      // initialExchangeRateMantissa_
    name,                                // name_
    symbol,                              // symbol_
    8,                                   // decimals_
    adminAddress,                        // admin_
    insolventCErc20Delegate.address,     // implementation_ (insolvent version)
    0x0                                  // becomeImplementationData,
  );
  await cErc20Delegator.deployed();
  const cErc20 = await hre.ethers.getContractAt("InsolventCErc20", cErc20Delegator.address, adminSigner);

  const tx = await cErc20._setReserveFactor(reserveFactor)
  await tx.wait()

  return cErc20
}

const deployCEther = async (name, symbol, reserveFactor, adminSigner) => {
  const CEther = await ethers.getContractFactory("InsolventCEther", adminSigner);
  const adminAddress = await adminSigner.getAddress()

  const cEther = await CEther.deploy(
    c.UNITROLLER_ADDRESS, //comptroller_
    "0xa4a5A4E04e0dFE6c792b3B8a71E818e263eD8678", //interestRateModel_ : WhitePaperModelV2Eth
    BigNumber.from("200388273633351366107209911"), //initialExchangeRateMantissa_
    name, //name_
    symbol, //symbol_
    8, //decimals_
    adminAddress, //admin_
  );
  await cEther.deployed();

  const tx = await cEther._setReserveFactor(reserveFactor);
  await tx.wait()

  return cEther
}

const deployComptroller = async (timelockSigner) => {
  const InsolventComptroller = await hre.ethers.getContractFactory("InsolventComptroller", timelockSigner);
  const comptrollerReplacement = await InsolventComptroller.deploy();
  await comptrollerReplacement.deployed();
  const unitroller = await hre.ethers.getContractAt("Unitroller", c.UNITROLLER_ADDRESS, timelockSigner);
  await unitroller._setPendingImplementation(comptrollerReplacement.address);
  await comptrollerReplacement._become(c.UNITROLLER_ADDRESS);
  const comptroller = await hre.ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, timelockSigner);

  await comptroller._setCloseFactor(BigNumber.from("1000000000000000000")); //100%
  await comptroller._setLiquidationIncentive(BigNumber.from("1000000000000000000")); //100%
  await comptroller._setSeizePaused(true);
  await comptroller._setTransferPaused(true);
  return { comptroller, comptrollerReplacement };
}

module.exports = {
  impersonateAccount,
  deployCErc20,
  deployCEther,
  deployComptroller
}
