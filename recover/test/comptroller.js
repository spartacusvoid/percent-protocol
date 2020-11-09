const { Assertion, expect } = require("chai");
const { TIMELOCK_ADDRESS, UNITROLLER_ADDRESS } = require("../constants");
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

describe("comptroller", function() {
  it("Should replace existing comptroller", async function() {
    const InsolventComptroller = await hre.ethers.getContractFactory("InsolventComptroller", timelockSigner);
    const comptrollerReplacement = await InsolventComptroller.deploy();
    await comptrollerReplacement.deployed();
    const unitroller = await hre.ethers.getContractAt("Unitroller", UNITROLLER_ADDRESS, timelockSigner);
    tx = await unitroller._setPendingImplementation(comptrollerReplacement.address);
    tx.wait();
    tx = await comptrollerReplacement._become(UNITROLLER_ADDRESS)
    const comptroller = await hre.ethers.getContractAt("InsolventComptroller", UNITROLLER_ADDRESS, timelockSigner);
    expect(await comptroller.comptrollerImplementation()).to.equal(comptrollerReplacement.address);
  });
})
