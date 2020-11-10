const { Assertion, expect } = require("chai");
const c = require("../constants");
const { impersonateAccount, deployCErc20 } = require("../utils");
const USDC_ABI = require("../usdc_abi");
let tx, timelockSigner, pUsdc

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS)
})

describe("pUsdc", function() {
  let pUsdc
  before(async function(){
    pUsdc = await deployCErc20(c.USDC_ADDRESS, "Percent USDC", "pUSDC", c.USDC_RESERVE_FACTOR, timelockSigner)
  })

  it("Should have timelock as admin", async function() {
    expect(await pUsdc.admin()).to.equal(c.TIMELOCK_ADDRESS);
  });

  it("Initialised hold/borrow balances are correct with haircut applied", async function(){
    tx = await pUsdc.specialInitState(c.BRICKED_PUSDC_ADDRESS, c.BRICKED_PUSDC_HOLDERS, c.BRICKED_PUSDC_BORROWERS);
    await tx.wait()

    const pUSDC_bricked = await hre.ethers.getContractAt("CTokenInterface", c.BRICKED_PUSDC_ADDRESS);

    const firstHolder = c.BRICKED_PUSDC_HOLDERS[0]
    const lastHolder = c.BRICKED_PUSDC_HOLDERS[c.BRICKED_PUSDC_HOLDERS.length-1]
    const firstBorrower = c.BRICKED_PUSDC_BORROWERS[0]
    const lastBorrower = c.BRICKED_PUSDC_BORROWERS[c.BRICKED_PUSDC_BORROWERS.length-1]

    expect((await pUsdc.balanceOf(firstHolder)).eq((await pUSDC_bricked.balanceOf(firstHolder)).mul(c.HAIRCUT_FACTOR).div(c.HAIRCUT_DENOM))).to.be.true
    expect((await pUsdc.balanceOf(lastHolder)).eq((await pUSDC_bricked.balanceOf(lastHolder)).mul(c.HAIRCUT_FACTOR).div(c.HAIRCUT_DENOM))).to.be.true
    expect((await pUsdc.borrowBalanceStored(firstBorrower)).eq(await pUSDC_bricked.borrowBalanceStored(firstBorrower))).to.be.true
    expect((await pUsdc.borrowBalanceStored(lastBorrower)).eq(await pUSDC_bricked.borrowBalanceStored(lastBorrower))).to.be.true
  })

  it("Can replace markets in comptroller", async function(){
    // const pUSDC_bricked = await hre.ethers.getContractAt("CTokenInterface", BRICKED_PUSDC_ADDRESS);
    const comptroller = await hre.ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, timelockSigner);
    tx = await comptroller._replaceMarket(pUsdc.address, c.BRICKED_PUSDC_ADDRESS, c.BRICKED_PUSDC_HOLDERS.concat(c.BRICKED_PUSDC_BORROWERS))
    await tx.wait()

    const newMarket = await comptroller.markets(pUsdc.address)
    const oldMarket = await comptroller.markets(c.BRICKED_PUSDC_ADDRESS)

    expect(newMarket.isListed).to.be.true
    expect(oldMarket.isListed).to.be.false

    expect(await comptroller.mintGuardianPaused(pUsdc.address)).to.be.true
    expect(await comptroller.borrowGuardianPaused(pUsdc.address)).to.be.true
  })

  it("Borrower can repay loan", async function() {
    const lockedUSDCBorrower = "0xda248cC10b477C1144219183EC87b0621DAC37b3"
    const usdc = await hre.ethers.getContractAt(USDC_ABI, c.USDC_ADDRESS)
    const borrowed = await pUsdc.borrowBalanceStored(lockedUSDCBorrower);
    let hasEnough = expect((await usdc.balanceOf(lockedUSDCBorrower)).gte(borrowed)).to.be.true
    if(hasEnough == Assertion.false)
      throw new Error("the example locked usdc borrower does not have enough funds to repay the loan. find another borrower that does or workout how to fake mint usdc to the borrower.")

    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [lockedUSDCBorrower]
    })
    const lockedUSDCSigner = await ethers.provider.getSigner(lockedUSDCBorrower)

    tx = await usdc.connect(lockedUSDCSigner).approve(pUsdc.address, c.MAX_INT)
    await tx.wait()

    tx = await pUsdc.connect(lockedUSDCSigner).repayBorrow(borrowed)
    await tx.wait()

    const finalBorrowBalance = await pUsdc.borrowBalanceStored(lockedUSDCBorrower)

    expect(finalBorrowBalance.lt(borrowed)).to.be.true
  });

});
