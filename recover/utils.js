const hre = require("hardhat");
const ethers = hre.ethers;
const { UNITROLLER_ADDRESS, INTEREST_RATE_MODEL_ADDRESS, INITIAL_EXCHANGE_RATE_MANTISSA } = require("./constants");

const impersonateAccount = async address => {
  const [account1] = await ethers.getSigners()
  const tx = await account1.sendTransaction({to: address, value: ethers.utils.parseEther("1.0")})
  await tx.wait()
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
    UNITROLLER_ADDRESS,                  // comptroller_
    INTEREST_RATE_MODEL_ADDRESS,         // interestRateModel_
    INITIAL_EXCHANGE_RATE_MANTISSA,      // initialExchangeRateMantissa_
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

module.exports = {
  impersonateAccount,
  deployCErc20
}
