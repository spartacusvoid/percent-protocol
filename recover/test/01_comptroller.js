const { BigNumber } = require('ethers');
const { Assertion, expect } = require("chai");
const c = require("../constants");
const { impersonateAccount, deployComptroller } = require("../utils");
let tx, timelockSigner

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS)
})

describe("comptroller", function() {
  it("Should replace existing comptroller", async function() {
    const {comptroller, comptrollerReplacement} = await deployComptroller(timelockSigner);
    expect(await comptroller.comptrollerImplementation()).to.equal(comptrollerReplacement.address);
  });
})
