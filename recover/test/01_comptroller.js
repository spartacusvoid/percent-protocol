const { BigNumber } = require('ethers');
const { Assertion, expect } = require("chai");
const c = require("../constants");
const { impersonateAccount, deployCErc20 } = require("../utils");
let tx, timelockSigner

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS)
})

describe("comptroller", function() {
  it("Should replace existing comptroller", async function() {
    const InsolventComptroller = await hre.ethers.getContractFactory("InsolventComptroller", timelockSigner);
    const comptrollerReplacement = await InsolventComptroller.deploy();
    await comptrollerReplacement.deployed();
    const unitroller = await hre.ethers.getContractAt("Unitroller", c.UNITROLLER_ADDRESS, timelockSigner);
    tx = await unitroller._setPendingImplementation(comptrollerReplacement.address);
    await tx.wait();
    tx = await comptrollerReplacement._become(c.UNITROLLER_ADDRESS)
    await tx.wait();
    const comptroller = await hre.ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, timelockSigner);

    await comptroller._setCloseFactor(BigNumber.from("1000000000000000000")); //100%
    await comptroller._setMaxAssets(20);
    await comptroller._setLiquidationIncentive(BigNumber.from("1000000000000000000")); //100%
    await comptroller._setSeizePaused(true);
    await comptroller._setTransferPaused(true);

    expect(await comptroller.comptrollerImplementation()).to.equal(comptrollerReplacement.address);
  });
})
