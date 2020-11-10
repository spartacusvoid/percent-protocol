const { expect } = require("chai");
const hre = require("hardhat");
const ethers = hre.ethers;
const { BigNumber } = ethers;
const c = require("../constants");
let addresses = require("../addresses.json");
let abi = require("../abi.json");
const { impersonateAccount, deployCErc20 } = require("../utils");
let tx, timelockSigner, pUsdc

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS)
})

describe("CEther", function() {
  it("Should deploy CEther", async function() {
    const signers = await ethers.getSigners();

    const old_pETH = new ethers.Contract(addresses.frozenTokens[0].address, abi.OLD_PETH_ABI, signers[0])

    const CEther = await ethers.getContractFactory("InsolventCEther");

    const admin = signers[0].address;

    const new_pETH = await CEther.deploy(
      addresses.unitroller, //comptroller_
      "0xa4a5A4E04e0dFE6c792b3B8a71E818e263eD8678", //interestRateModel_ : WhitePaperModelV2Eth
      BigNumber.from("200388273633351366107209911"), //initialExchangeRateMantissa_
      "TEST Percent Ether", //name_
      "TPETH", //symbol_
      8, //decimals_
      admin, //admin_
    );
    await new_pETH.deployed();

    expect(await new_pETH.totalSupply() == 0).to.equal(true);
    await new_pETH.setInitialParameters();
    await new_pETH.accrueInterest();

    expect(await new_pETH.totalSupply() == 92327748758).to.equal(true);
    expect(await new_pETH.totalBorrows() / 1e18).to.be.closeTo(await old_pETH.totalBorrows() / 1e18, 0.01);

    const owedEth = await old_pETH.totalBorrows() / 1e8;

    const depositedEth = await old_pETH.totalSupply() / 1e8 * await old_pETH.exchangeRateStored() / 1e18;

    const hairCut = owedEth / depositedEth;

    const oldTopAccountSnapshot = await old_pETH.getAccountSnapshot("0xFb626333099A91Ab677BCd5e9C71bc4Dbe0238a8");
    const oldTopBalance = oldTopAccountSnapshot[1] / 1e8 * oldTopAccountSnapshot[3] / 1e18;

    const newTopAccountSnapshot = await new_pETH.getAccountSnapshot("0xFb626333099A91Ab677BCd5e9C71bc4Dbe0238a8");
    const newTopBalance = newTopAccountSnapshot[1] / 1e8 * newTopAccountSnapshot[3] / 1e18;

    expect(newTopBalance / oldTopBalance).to.be.closeTo(hairCut, 0.01);

  });
});

// const impersonateAccount = async address => {
//   await hre.network.provider.request({
//     method: "hardhat_impersonateAccount",
//     params: [address]
//   })
// }

// describe("Timelock", function() {
//   it("Should impersonate timelock", async function () {
//     const [account1] = await ethers.getSigners()
//     tx = await account1.sendTransaction({to: addresses.timelock, value: ethers.utils.parseEther("1.0")})
//     await tx.wait();
//     await impersonateAccount(addresses.timelock);
//     const timelockSigner = ethers.provider.getSigner(addresses.timelock);
//     const unitroller = new ethers.Contract(addresses.unitroller, abi.UNITROLLER_ABI, timelockSigner);
//     await unitroller._setPendingAdmin(account1.address);
//     const unitrollerAsAccount1 = unitroller.connect(account1);
//     await unitrollerAsAccount1._acceptAdmin();
//   })
// })

describe("Recovery", function() {
  it("Should create new Comptroller and add new pETH contract", async function () {
    // const signers = await ethers.getSigners();
    //
    // const Unitroller = await ethers.getContractFactory("Unitroller");
    // const new_Unitroller = await Unitroller.deploy();
    // await new_Unitroller.deployed();
    // const Comptroller = await ethers.getContractFactory("Comptroller");
    // const new_Comptroller = await Comptroller.deploy();
    // await new_Comptroller.deployed();
    // await new_Unitroller._setPendingImplementation(new_Comptroller.address);
    // await new_Comptroller._become(new_Unitroller.address);
    //
    // const comptroller = new ethers.Contract(new_Unitroller.address, abi.COMPTROLLER_ABI, signers[0]);
    // await comptroller._setPriceOracle(addresses.chainlinkPriceOracleProxy);
    // await comptroller._setCloseFactor(BigNumber.from("1000000000000000000")); //100%
    // await comptroller._setMaxAssets(20);
    // await comptroller._setLiquidationIncentive(BigNumber.from("1000000000000000000")); //100%
    // await comptroller._setSeizePaused(true);
    // await comptroller._setTransferPaused(true);
    const comptroller = await hre.ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, timelockSigner);
    const CEther = await ethers.getContractFactory("InsolventCEther", timelockSigner);

    const new_pETH = await CEther.deploy(
      comptroller.address, //comptroller_
      "0xa4a5A4E04e0dFE6c792b3B8a71E818e263eD8678", //interestRateModel_ : WhitePaperModelV2Eth
      BigNumber.from("200388273633351366107209911"), //initialExchangeRateMantissa_
      "TEST Percent Ether", //name_
      "TPETH", //symbol_
      8, //decimals_
      c.TIMELOCK_ADDRESS, //admin_
    );
    await new_pETH.deployed();

    tx = await new_pETH.setInitialParameters();
    await tx.wait();

    tx = await comptroller._replaceMarket(new_pETH.address, c.BRICKED_PETH_ADDRESS, [])
    await tx.wait();
    // tx = await comptroller._supportMarket(new_pETH.address);
    tx = await comptroller._setMintPaused(new_pETH.address, true);
    await tx.wait();
    tx = await comptroller._setBorrowPaused(new_pETH.address, true);
    await tx.wait();
    tx = await new_pETH.accrueInterest();
    await tx.wait();

    // const tx = await signers[0].sendTransaction({to: addresses.timelock, value: ethers.utils.parseEther("1.0")})
    // await tx.wait();
    // await impersonateAccount(addresses.timelock);
    // const timelockSigner = ethers.provider.getSigner(addresses.timelock);

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
