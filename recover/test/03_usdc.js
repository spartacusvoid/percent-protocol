const { Assertion, expect } = require("chai");
const c = require("../constants");
const { impersonateAccount, deployCErc20 } = require("../utils");
const USDC_ABI = require("../usdc_abi");
const { Zero } = ethers.constants
let tx, timelockSigner, new_pUSDC, old_pUSDC, comptroller, chainlinkPriceOracle

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS)
})

describe("pUSDC", function() {
  let new_pUSDC
  before(async function(){
    old_pUSDC = await ethers.getContractAt("CTokenInterface", c.BRICKED_PUSDC_ADDRESS)
    new_pUSDC = await deployCErc20(c.USDC_ADDRESS, "Percent USDC", "pUSDC", await old_pUSDC.reserveFactorMantissa(), timelockSigner)
    comptroller = await hre.ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, timelockSigner);
    chainlinkPriceOracle = await hre.ethers.getContractAt("ChainlinkPriceOracleProxy", c.CHAINLINK_PRICE_ORACLE_PROXY_ADDRESS, timelockSigner);
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
    await chainlinkPriceOracle.setTokenConfigs([new_pUSDC.address], [c.USDC_CHAINLINE_AGGREGATOR_ADDRESS], [2], [6])
    await comptroller._replaceMarket(new_pUSDC.address, c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS)

    const newMarket = await comptroller.markets(new_pUSDC.address)
    const oldMarket = await comptroller.markets(c.BRICKED_PUSDC_ADDRESS)

    expect(newMarket.isListed).to.be.true
    expect(oldMarket.isListed).to.be.false

    expect(await comptroller.mintGuardianPaused(new_pUSDC.address)).to.be.true
    expect(await comptroller.borrowGuardianPaused(new_pUSDC.address)).to.be.true
  })

  it("Borrowers can repay", async function() {
    const usdcMegaHolderSigner = await impersonateAccount("0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8") // just an account with a lot of usdc (binance in this case)
    const usdc = await hre.ethers.getContractAt(USDC_ABI, c.USDC_ADDRESS)

    async function repayLoan(account){
      const borrowed = await new_pUSDC.borrowBalanceStored(account);
      if(borrowed.eq(Zero)) return
      // send enough usdc to account so they can repay loan
      await usdc.connect(usdcMegaHolderSigner).transfer(account, borrowed)
      const signer = await impersonateAccount(account)
      await usdc.connect(signer).approve(new_pUSDC.address, c.MAX_INT)
      await new_pUSDC.connect(signer).repayBorrow(borrowed)
      const finalBorrowBalance = await new_pUSDC.borrowBalanceStored(account)
      expect(finalBorrowBalance.lt(borrowed)).to.be.true
    }
    await Promise.all(c.PUSDC_ACCOUNTS.map(async a=>(await repayLoan(a))))
  });

  it("Repaid funds can be redeemed by suppliers", async function() {
    const usdc = await hre.ethers.getContractAt(USDC_ABI, c.USDC_ADDRESS)
    const totalUnderlyingStart = await usdc.balanceOf(new_pUSDC.address)
    console.log("START total underlying usdc: ", totalUnderlyingStart)
    console.log("chainlink oracle price", await chainlinkPriceOracle.getUnderlyingPrice(new_pUSDC.address));
    async function redeem(account){
      const collat = await new_pUSDC.balanceOf(account);
      if(collat.eq(Zero)) return
      let err,liquidity,shortfall

      // some accounts cause a revert
      try {
        [err, liquidity, shortfall] = await comptroller.getAccountLiquidity(account)
      } catch(e){
        console.log(`getAccountLiquidity reverted for ${account}`)
        return
      }
      // if(liquidity.eq(Zero)) return
      // console.log(`${account} collat   : ${collat}`)
      // console.log(`${account} liquidity: ${liquidity}`)

      const signer = await impersonateAccount(account)
      await new_pUSDC.connect(signer).redeem(collat)
      // await tx.wait()
      // console.log(await new_pUSDC.balanceOf(account));

    }
    // await Promise.all(c.PUSDC_ACCOUNTS.map(async a=>(await redeem(a))))

    await Promise.all(c.PUSDC_ACCOUNTS.map(async a=>(await redeem(a))))
    const totalUnderlyingEnd = await usdc.balanceOf(new_pUSDC.address)
    console.log("END total underlying usdc: ", totalUnderlyingEnd)
    // await redeem(c.PUSDC_ACCOUNTS[c.PUSDC_ACCOUNTS.length-1])

  });

  it("Repaid account can withdraw", async function() {

  });

});
