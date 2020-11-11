const { Assertion, expect } = require("chai");
const c = require("../constants");
const { impersonateAccount, deployCErc20 } = require("../utils");
const USDC_ABI = require("../usdc_abi");
let tx, timelockSigner, new_pUSDC, old_pUSDC

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS)
})

describe("pUSDC", function() {
  let new_pUSDC
  before(async function(){
    old_pUSDC = await ethers.getContractAt("CTokenInterface", c.BRICKED_PUSDC_ADDRESS)
    new_pUSDC = await deployCErc20(c.USDC_ADDRESS, "Percent USDC", "pUSDC", await old_pUSDC.reserveFactorMantissa(), timelockSigner)
  })

  it("Should have timelock as admin", async function() {
    expect(await new_pUSDC.admin()).to.equal(c.TIMELOCK_ADDRESS);
  });

  it("Can Initialise correct balances", async function() {
    expect(await new_pUSDC.totalSupply() == 0).to.equal(true);
    tx = await new_pUSDC.specialInitState(c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS);
    await tx.wait()

    await new_pUSDC.accrueInterest();

    const newTotalSupply = await new_pUSDC.totalSupply();
    const newExchangeRate = await new_pUSDC.exchangeRateStored();
    const newTotalBorrows = await new_pUSDC.totalBorrows();

    const newUnderlyingSupply = newTotalSupply * newExchangeRate / 1e18;

    expect(newUnderlyingSupply / 1e6).to.be.closeTo(newTotalBorrows / 1e6, 0.1);
    expect(newTotalBorrows / 1e18).to.be.closeTo(await old_pUSDC.totalBorrows() / 1e18, 0.01);

    let totalPositiveOutlay = 0;
    let totalNegativeOutlay = 0;
    for (const a of c.PUSDC_ACCOUNTS) {
        let snapshot = await old_pUSDC.getAccountSnapshot(a);
        let supply = snapshot[1] / 1e6 * snapshot[3] / 1e18;
        let borrow = snapshot[2] / 1e6;
        if (supply > borrow) {
            totalPositiveOutlay += supply - borrow;
        }
        else {
            totalNegativeOutlay += borrow - supply;
        }
    }
    console.log(`Total Positive Outlay: ${totalPositiveOutlay}`);
    console.log(`Total Negative Outlay: ${totalNegativeOutlay}`);
    const hairCut = (totalPositiveOutlay - totalNegativeOutlay) / totalPositiveOutlay;
    console.log(`Haircut: ${hairCut}`);

    const oldTopAccountSnapshot = await old_pUSDC.getAccountSnapshot("0xD9B99266C42d427Bb3A64f30a0242bbEb41F6830");
    const oldTopBalance = oldTopAccountSnapshot[1] / 1e6 * oldTopAccountSnapshot[3] / 1e18 -
        oldTopAccountSnapshot[2] / 1e6;

    const newTopAccountSnapshot = await new_pUSDC.getAccountSnapshot("0xD9B99266C42d427Bb3A64f30a0242bbEb41F6830");
    const newTopBalance = newTopAccountSnapshot[1] / 1e6 * newTopAccountSnapshot[3] / 1e18;

    console.log(`Old ${oldTopBalance} New ${newTopBalance}`);
    expect(1 - newTopBalance / oldTopBalance).to.be.closeTo(hairCut, 0.01);

  });

  it("Can replace old market in comptroller", async function(){
    // const pUSDC_bricked = await hre.ethers.getContractAt("CTokenInterface", BRICKED_PUSDC_ADDRESS);
    const comptroller = await hre.ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, timelockSigner);
    tx = await comptroller._replaceMarket(new_pUSDC.address, c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS)
    await tx.wait()

    const newMarket = await comptroller.markets(new_pUSDC.address)
    const oldMarket = await comptroller.markets(c.BRICKED_PUSDC_ADDRESS)

    expect(newMarket.isListed).to.be.true
    expect(oldMarket.isListed).to.be.false

    expect(await comptroller.mintGuardianPaused(new_pUSDC.address)).to.be.true
    expect(await comptroller.borrowGuardianPaused(new_pUSDC.address)).to.be.true
  })

  // it("Borrower can repay loan", async function() {
  //   const lockedUSDCBorrower = "0xda248cC10b477C1144219183EC87b0621DAC37b3"
  //   const usdc = await hre.ethers.getContractAt(USDC_ABI, c.USDC_ADDRESS)
  //   const borrowed = await new_pUSDC.borrowBalanceStored(lockedUSDCBorrower);
  //   let hasEnough = expect((await usdc.balanceOf(lockedUSDCBorrower)).gte(borrowed)).to.be.true
  //   if(hasEnough == Assertion.false)
  //     throw new Error("the example locked usdc borrower does not have enough funds to repay the loan. find another borrower that does or workout how to fake mint usdc to the borrower.")
  //
  //   await hre.network.provider.request({
  //     method: "hardhat_impersonateAccount",
  //     params: [lockedUSDCBorrower]
  //   })
  //   const lockedUSDCSigner = await ethers.provider.getSigner(lockedUSDCBorrower)
  //
  //   tx = await usdc.connect(lockedUSDCSigner).approve(new_pUSDC.address, c.MAX_INT)
  //   await tx.wait()
  //
  //   tx = await new_pUSDC.connect(lockedUSDCSigner).repayBorrow(borrowed)
  //   await tx.wait()
  //
  //   const finalBorrowBalance = await new_pUSDC.borrowBalanceStored(lockedUSDCBorrower)
  //
  //   expect(finalBorrowBalance.lt(borrowed)).to.be.true
  // });

});
