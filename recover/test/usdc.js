const { expect } = require("chai");
const { MAX_INT, INITIAL_EXCHANGE_RATE_MANTISSA, TIMELOCK_ADDRESS, UNITROLLER_ADDRESS, USDC_ADDRESS, INTEREST_RATE_MODEL_ADDRESS, CERC20_DELEGATE_ADDRESS, CHAINLINK_PRICE_ORACLE_PROXY_ADDRESS, USDC_CHAINLINE_AGGREGATOR_ADDRESS, BRICKED_PUSDC_ADDRESS, BRICKED_PUSDC_HOLDERS, BRICKED_PUSDC_BORROWERS } = require("../constants")

describe("pUsdc", function() {
  it("Should deploy with timelock as admin", async function() {
    const [account1, account2] = await ethers.getSigners()
    tx = await account1.sendTransaction({to: TIMELOCK_ADDRESS, value: ethers.utils.parseEther("1.0")})
    tx.wait()
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [TIMELOCK_ADDRESS]
    })
    const timelockSigner = await ethers.provider.getSigner(TIMELOCK_ADDRESS)

    const InsolventCErc20Delegate = await hre.ethers.getContractFactory("InsolventCErc20Delegate", timelockSigner);
    let insolventCErc20Delegate = await InsolventCErc20Delegate.deploy();
    await insolventCErc20Delegate.deployed();

    const InsolventCErc20Delegator = await hre.ethers.getContractFactory("CErc20Delegator", timelockSigner);
    const pUsdcDelegator = await InsolventCErc20Delegator.deploy(
      USDC_ADDRESS,                        // underlying_
      UNITROLLER_ADDRESS,                  // comptroller_
      INTEREST_RATE_MODEL_ADDRESS,           // interestRateModel_
      INITIAL_EXCHANGE_RATE_MANTISSA,        // initialExchangeRateMantissa_
      "Percent USDC",                     // name_
      "pUSDC",                            // symbol_
      8,                                  // decimals_
      TIMELOCK_ADDRESS,                    // admin_
      // account1.address,                    // admin_
      insolventCErc20Delegate.address,    // implementation_ (insolvent version)
      0x0                                 // becomeImplementationData,
    );

    await pUsdcDelegator.deployed();
    const pUsdc = await hre.ethers.getContractAt("InsolventCErc20", pUsdcDelegator.address, timelockSigner);

    expect(await pUsdc.admin()).to.equal(TIMELOCK_ADDRESS);
  });
});
