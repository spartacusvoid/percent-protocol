const { expect } = require("chai");
const c = require("../constants");
const { impersonateAccount, deployCErc20, deployCEther } = require("../utils");
let abi = require("../abi.json");
let addresses = require("../addresses.json");
let tx, timelockSigner, old_pETH, new_pETH

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS)
})

describe("pETH", function() {
  let new_pUSDC
  before(async function(){
    old_pETH = await ethers.getContractAt("CTokenInterface", c.BRICKED_PUSDC_ADDRESS)
    new_pETH = await deployCEther("TEST Percent PETH", "TPETH", await old_pETH.reserveFactorMantissa(), timelockSigner)
  })

  it("Should have timelock as admin", async function() {
    expect(await new_pETH.admin()).to.equal(c.TIMELOCK_ADDRESS);
  });

  it("Can Initialise correct balances", async function() {
    expect(await new_pETH.totalSupply() == 0).to.equal(true);
    tx = await new_pETH.specialInitState(c.BRICKED_PETH_ADDRESS, c.PETH_ACCOUNTS);
    await tx.wait()

    await new_pETH.accrueInterest();

    const newTotalSupply = await new_pETH.totalSupply();
    const newExchangeRate = await new_pETH.exchangeRateStored();
    const newTotalBorrows = await new_pETH.totalBorrows();

    const newUnderlyingSupply = newTotalSupply * newExchangeRate / 1e18;

    expect(newUnderlyingSupply / 1e18).to.be.closeTo(newTotalBorrows / 1e18, 0.01);
    expect(newTotalBorrows / 1e18).to.be.closeTo(await old_pETH.totalBorrows() / 1e18, 0.01);

    const owedEth = await old_pETH.totalBorrows() / 1e8;

    const depositedEth = await old_pETH.totalSupply() / 1e8 * await old_pETH.exchangeRateStored() / 1e18;

    const hairCut = owedEth / depositedEth;

    const oldTopAccountSnapshot = await old_pETH.getAccountSnapshot("0xFb626333099A91Ab677BCd5e9C71bc4Dbe0238a8");
    const oldTopBalance = oldTopAccountSnapshot[1] / 1e8 * oldTopAccountSnapshot[3] / 1e18;

    const newTopAccountSnapshot = await new_pETH.getAccountSnapshot("0xFb626333099A91Ab677BCd5e9C71bc4Dbe0238a8");
    const newTopBalance = newTopAccountSnapshot[1] / 1e8 * newTopAccountSnapshot[3] / 1e18;

    expect(newTopBalance / oldTopBalance).to.be.closeTo(hairCut, 0.01);
  })

  it("Can replace old market in comptroller", async function(){
    // const pUSDC_bricked = await hre.ethers.getContractAt("CTokenInterface", BRICKED_PUSDC_ADDRESS);
    const comptroller = await hre.ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, timelockSigner);
    tx = await comptroller._replaceMarket(new_pETH.address, c.BRICKED_PETH_ADDRESS, c.PUSDC_ACCOUNTS)
    await tx.wait()

    const newMarket = await comptroller.markets(new_pETH.address)
    const oldMarket = await comptroller.markets(c.BRICKED_PETH_ADDRESS)

    expect(newMarket.isListed).to.be.true
    expect(oldMarket.isListed).to.be.false

    expect(await comptroller.mintGuardianPaused(new_pETH.address)).to.be.true
    expect(await comptroller.borrowGuardianPaused(new_pETH.address)).to.be.true

    // addresses.workingTokens.forEach(async t => {
    //   const token = new ethers.Contract(t.address, abi.CTOKEN_ABI, timelockSigner);
    //   await token._setComptroller(comptroller.address);
    //
    //   await comptroller._supportMarket(t.address);
    //   await comptroller._setMintPaused(t.address, true);
    //   await comptroller._setBorrowPaused(t.address, true);
    //   await token.accrueInterest();
    // });
    //
    // const old_comptroller = new ethers.Contract(addresses.unitroller, abi.COMPTROLLER_ABI, timelockSigner);
    //
    // console.log(await old_comptroller.getAssetsIn(addresses.yfiLender));
    // console.log(await old_comptroller.getAccountLiquidity(addresses.yfiLender));
  })

});
