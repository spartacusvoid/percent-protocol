const { expect } = require("chai");
const c = require("../constants");
const { impersonateAccount, deployCErc20 } = require("../utils");
let timelockSigner, new_pWBTC, old_pWBTC

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS)
})

describe("pWBTC", function() {
  before(async function(){
    old_pWBTC = await ethers.getContractAt("CTokenInterface", c.BRICKED_PWBTC_ADDRESS)
    new_pWBTC = await deployCErc20(c.WBTC_ADDRESS, "Percent WBTC", "pWBTC", await old_pWBTC.reserveFactorMantissa(), timelockSigner);
  })

  it("Should have timelock as admin", async function() {
    expect(await new_pWBTC.admin()).to.equal(c.TIMELOCK_ADDRESS);
  });

  it("Can Initialise correct balances", async function() {
    expect(await new_pWBTC.totalSupply() == 0).to.equal(true);
    await new_pWBTC.specialInitState(c.BRICKED_PWBTC_ADDRESS, c.PWBTC_ACCOUNTS);

    await new_pWBTC.accrueInterest();

    const newTotalSupply = await new_pWBTC.totalSupply();
    const newExchangeRate = await new_pWBTC.exchangeRateStored();
    const newTotalBorrows = await new_pWBTC.totalBorrows();

    const newUnderlyingSupply = newTotalSupply * newExchangeRate / 1e18;

    expect(newUnderlyingSupply / 1e8).to.be.closeTo(newTotalBorrows / 1e8, 0.1);
    expect(newTotalBorrows / 1e18).to.be.closeTo(await old_pWBTC.totalBorrows() / 1e18, 0.01);

    let totalPositiveOutlay = 0;
    let totalNegativeOutlay = 0;
    for (const a of c.PWBTC_ACCOUNTS) {
        let snapshot = await old_pWBTC.getAccountSnapshot(a);
        let supply = snapshot[1] / 1e8 * snapshot[3] / 1e18;
        let borrow = snapshot[2] / 1e8;
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

    const oldTopAccountSnapshot = await old_pWBTC.getAccountSnapshot(c.PWBTC_ACCOUNTS[0]);
    const oldTopBalance = oldTopAccountSnapshot[1] / 1e8 * oldTopAccountSnapshot[3] / 1e18 -
        oldTopAccountSnapshot[2] / 1e8;

    const newTopAccountSnapshot = await new_pWBTC.getAccountSnapshot(c.PWBTC_ACCOUNTS[0]);
    const newTopBalance = newTopAccountSnapshot[1] / 1e8 * newTopAccountSnapshot[3] / 1e18;

    console.log(`Old ${oldTopBalance} New ${newTopBalance}`);
    expect(1 - newTopBalance / oldTopBalance).to.be.closeTo(hairCut, 0.01);

  });
});
