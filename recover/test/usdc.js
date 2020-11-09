const { Assertion, expect } = require("chai");
const USDC_ABI = require("../usdc_abi");
const { HAIRCUT_FACTOR, HAIRCUT_DENOM, USDC_RESERVE_FACTOR, MAX_INT, INITIAL_EXCHANGE_RATE_MANTISSA, TIMELOCK_ADDRESS, UNITROLLER_ADDRESS, USDC_ADDRESS, INTEREST_RATE_MODEL_ADDRESS, CERC20_DELEGATE_ADDRESS, CHAINLINK_PRICE_ORACLE_PROXY_ADDRESS, USDC_CHAINLINE_AGGREGATOR_ADDRESS, BRICKED_PUSDC_ADDRESS, BRICKED_PUSDC_HOLDERS, BRICKED_PUSDC_BORROWERS } = require("../constants")
let account1, account2, tx, timelockSigner

before(async function(){
  [account1, account2] = await ethers.getSigners()
  tx = await account1.sendTransaction({to: TIMELOCK_ADDRESS, value: ethers.utils.parseEther("1.0")})
  tx.wait()
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [TIMELOCK_ADDRESS]
  })
  timelockSigner = await ethers.provider.getSigner(TIMELOCK_ADDRESS)
})

describe("pUsdc", function() {
  let pUsdc
  before(async function(){
    const InsolventCErc20Delegate = await hre.ethers.getContractFactory("InsolventCErc20Delegate", timelockSigner);
    const insolventCErc20Delegate = await InsolventCErc20Delegate.deploy();
    await insolventCErc20Delegate.deployed();

    const InsolventCErc20Delegator = await hre.ethers.getContractFactory("CErc20Delegator", timelockSigner);
    pUsdc = await InsolventCErc20Delegator.deploy(
      USDC_ADDRESS,                        // underlying_
      UNITROLLER_ADDRESS,                  // comptroller_
      INTEREST_RATE_MODEL_ADDRESS,         // interestRateModel_
      INITIAL_EXCHANGE_RATE_MANTISSA,      // initialExchangeRateMantissa_
      "Percent USDC",                      // name_
      "pUSDC",                             // symbol_
      8,                                   // decimals_
      TIMELOCK_ADDRESS,                    // admin_
      insolventCErc20Delegate.address,     // implementation_ (insolvent version)
      0x0                                  // becomeImplementationData,
    );
    await pUsdc.deployed();
    pUsdc = await hre.ethers.getContractAt("InsolventCErc20", pUsdc.address, timelockSigner);
  })

  it("Should have timelock as admin", async function() {
    expect(await pUsdc.admin()).to.equal(TIMELOCK_ADDRESS);
  });

  it("Initialised hold/borrow balances are correct with haircut applied", async function(){
    tx = await pUsdc.specialInitState(BRICKED_PUSDC_ADDRESS, BRICKED_PUSDC_HOLDERS, BRICKED_PUSDC_BORROWERS);
    await tx.wait()

    const pUSDC_bricked = await hre.ethers.getContractAt("CTokenInterface", BRICKED_PUSDC_ADDRESS);

    const firstHolder = BRICKED_PUSDC_HOLDERS[0]
    const lastHolder = BRICKED_PUSDC_HOLDERS[BRICKED_PUSDC_HOLDERS.length-1]
    const firstBorrower = BRICKED_PUSDC_BORROWERS[0]
    const lastBorrower = BRICKED_PUSDC_BORROWERS[BRICKED_PUSDC_BORROWERS.length-1]

    expect((await pUsdc.balanceOf(firstHolder)).eq((await pUSDC_bricked.balanceOf(firstHolder)).mul(HAIRCUT_FACTOR).div(HAIRCUT_DENOM))).to.be.true
    expect((await pUsdc.balanceOf(lastHolder)).eq((await pUSDC_bricked.balanceOf(lastHolder)).mul(HAIRCUT_FACTOR).div(HAIRCUT_DENOM))).to.be.true
    expect((await pUsdc.borrowBalanceStored(firstBorrower)).eq(await pUSDC_bricked.borrowBalanceStored(firstBorrower))).to.be.true
    expect((await pUsdc.borrowBalanceStored(lastBorrower)).eq(await pUSDC_bricked.borrowBalanceStored(lastBorrower))).to.be.true
  })

  it("Can be added to comptroller", async function(){
    const comptroller = await hre.ethers.getContractAt("Comptroller", UNITROLLER_ADDRESS, timelockSigner);
    tx = await comptroller._supportMarket(pUsdc.address)
    await tx.wait()

    tx = await pUsdc._setReserveFactor(USDC_RESERVE_FACTOR)
    await tx.wait()
  })

  it("Borrower can repay loan", async function() {
    const lockedUSDCBorrower = "0xda248cC10b477C1144219183EC87b0621DAC37b3"
    const usdc = await hre.ethers.getContractAt(USDC_ABI, USDC_ADDRESS)
    const borrowed = await pUsdc.borrowBalanceStored(lockedUSDCBorrower);
    let hasEnough = expect((await usdc.balanceOf(lockedUSDCBorrower)).gte(borrowed)).to.be.true
    if(hasEnough == Assertion.false)
      throw new Error("the example locked usdc borrower does not have enough funds to repay the loan. find another borrower that does or workout how to fake mint usdc to the borrower.")

    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [lockedUSDCBorrower]
    })
    const lockedUSDCSigner = await ethers.provider.getSigner(lockedUSDCBorrower)

    tx = await usdc.connect(lockedUSDCSigner).approve(pUsdc.address, MAX_INT)
    await tx.wait()

    tx = await pUsdc.connect(lockedUSDCSigner).repayBorrow(borrowed)
    await tx.wait()

    const finalBorrowBalance = await pUsdc.borrowBalanceStored(lockedUSDCBorrower)

    expect(finalBorrowBalance.lt(borrowed)).to.be.true
  });

});
