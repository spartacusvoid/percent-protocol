const { BigNumber } = require('ethers');
const { expect } = require("chai");
let addresses = require("../addresses.json");
let abi = require("../abi.json");
const { ethers } = require('hardhat');

describe("pUSDC", function() {
  it("Should deploy pUSDC", async function() {
    const signers = await ethers.getSigners();

    const old_pUSDCaddress = addresses.frozenTokens[1].address;
    const old_pUSDC = new ethers.Contract(old_pUSDCaddress, abi.OLD_PETH_ABI, signers[0])

    const InsolventCErc20Delegate = await ethers.getContractFactory("InsolventCErc20Delegate");
    const insolventCErc20Delegate = await InsolventCErc20Delegate.deploy();
    await insolventCErc20Delegate.deployed();
    const CErc20Delegator = await ethers.getContractFactory("CErc20Delegator");

    const admin = signers[0].address;

    const cErc20Delegator = await CErc20Delegator.deploy(
        addresses.usdc,
        addresses.unitroller, //comptroller_
        await old_pUSDC.interestRateModel(), //interestRateModel_ : WhitePaperModelV2Eth
        await old_pUSDC.exchangeRateStored(), //initialExchangeRateMantissa_
        "TEST Percent USDC", //name_
        "TPUSDC", //symbol_
        6, //decimals_
        admin, //admin_
        insolventCErc20Delegate.address,     // implementation_ (insolvent version)
        0x0                                  // becomeImplementationData,
    );
    await cErc20Delegator.deployed();

    const new_pUSDC = await ethers.getContractAt("InsolventCErc20", cErc20Delegator.address, signers[0]);

    await new_pUSDC._setReserveFactor(await old_pUSDC.reserveFactorMantissa());

    expect(await new_pUSDC.totalSupply() == 0).to.equal(true);

    await new_pUSDC.specialInitState2(old_pUSDCaddress, addresses.usdcAccounts);
    await new_pUSDC.accrueInterest();

    const newTotalSupply = await new_pUSDC.totalSupply();
    const newExchangeRate = await new_pUSDC.exchangeRateStored();
    const newTotalBorrows = await new_pUSDC.totalBorrows();

    const newUnderlyingSupply = newTotalSupply * newExchangeRate / 1e18;

    expect(newUnderlyingSupply / 1e6).to.be.closeTo(newTotalBorrows / 1e6, 0.1);
    expect(newTotalBorrows / 1e18).to.be.closeTo(await old_pUSDC.totalBorrows() / 1e18, 0.01);

    let totalPositiveOutlay = 0;
    let totalNegativeOutlay = 0;
    for (const a of addresses.usdcAccounts) {
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
});