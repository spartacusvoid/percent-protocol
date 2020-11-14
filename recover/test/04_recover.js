const { expect } = require("chai");
const c = require("../constants");
const { impersonateAccount, deployCErc20, deployCEther, deployComptroller } = require("../utils");
const USDC_ABI = require("../usdc_abi");
const { Zero } = ethers.constants
let timelockSigner, new_pUSDC, old_pUSDC, comptroller, chainlinkPriceOracle,
    usdcMegaHolderSigner, usdc

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS);
  const {c1, _ } = await deployComptroller(timelockSigner);
  comptroller = c1;
  old_pUSDC = await hre.ethers.getContractAt("CTokenInterface", c.BRICKED_PUSDC_ADDRESS);
  new_pUSDC = await deployCErc20(c.USDC_ADDRESS, "Percent USDC", "pUSDC", await old_pUSDC.reserveFactorMantissa(), timelockSigner);
  old_pETH = await hre.ethers.getContractAt("CTokenInterface", c.BRICKED_PETH_ADDRESS);
  new_pETH = await deployCEther("Percent Ether", "pETH", await old_pETH.reserveFactorMantissa(), timelockSigner);
  comptroller = await hre.ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, timelockSigner);
  chainlinkPriceOracle = await hre.ethers.getContractAt("ChainlinkPriceOracleProxy", c.CHAINLINK_PRICE_ORACLE_PROXY_ADDRESS, timelockSigner);
  await new_pUSDC.specialInitState(c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS);
  await new_pETH.specialInitState(c.BRICKED_PETH_ADDRESS, c.PETH_ACCOUNTS);
  await chainlinkPriceOracle.setTokenConfigs(
      [new_pUSDC.address, new_pETH.address], 
      [c.USDC_CHAINLINK_AGGREGATOR_ADDRESS, c.ETH_CHAINLINK_AGGREGATOR_ADDRESS], 
      [2,1],
      [6,18]);
  await comptroller._replaceMarket(new_pUSDC.address, c.BRICKED_PUSDC_ADDRESS, c.PUSDC_ACCOUNTS);
  await comptroller._replaceMarket(new_pETH.address, c.BRICKED_PETH_ADDRESS, c.PETH_ACCOUNTS);
  usdcMegaHolderSigner = await impersonateAccount("0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8") // just an account with a lot of usdc (binance in this case)
  usdc = await hre.ethers.getContractAt(USDC_ABI, c.USDC_ADDRESS)
})

async function repayUsdcLoan(account){
    const borrowed = await new_pUSDC.borrowBalanceStored(account);
    if(borrowed.eq(Zero)) return
    // send enough usdc to account so they can repay loan
    await usdc.connect(usdcMegaHolderSigner).transfer(account, borrowed)
    const signer = await impersonateAccount(account)
    await usdc.connect(signer).approve(new_pUSDC.address, c.MAX_INT)
    await new_pUSDC.connect(signer).repayBorrow(borrowed)
    const finalBorrowBalance = await new_pUSDC.borrowBalanceStored(account)
    expect(finalBorrowBalance / 1e18).to.be.closeTo(0, 0.001);
}

async function repayEthLoan(account){
    const borrowed = await new_pETH.borrowBalanceStored(account);
    if(borrowed.eq(Zero)) return
    // send enough ETH to account so they can repay loan
    const [account1] = await ethers.getSigners()
    await account1.sendTransaction({to: account, value: borrowed});
    const signer = await impersonateAccount(account)
    await new_pETH.connect(signer).repayBorrow({ value : borrowed});
    const finalBorrowBalance = await new_pETH.borrowBalanceStored(account)
    expect(finalBorrowBalance / 1e18).to.be.closeTo(0, 0.001);
}

async function redeem(pToken, account){
    const collat = await pToken.balanceOf(account);
    if(collat.eq(Zero)) return;
    const signer = await impersonateAccount(account);
    await pToken.connect(signer).redeem(collat);
    const collatAfter = await pToken.balanceOf(account);
    console.log(`${account} collateral before: ${collat} after: ${collatAfter}`);
}

async function redeemEth(account) {
    await redeem(new_pETH, account);
} 

async function redeemUsdc(account) {
    await redeem(new_pUSDC, account);
}

describe("Recovery", function () {
    it("Can replace ETH market in comptroller", async function(){  
      const newMarket = await comptroller.markets(new_pETH.address)
      const oldMarket = await comptroller.markets(c.BRICKED_PETH_ADDRESS)
  
      expect(newMarket.isListed).to.be.true
      expect(oldMarket.isListed).to.be.false
  
      expect(await comptroller.mintGuardianPaused(new_pETH.address)).to.be.true
      expect(await comptroller.borrowGuardianPaused(new_pETH.address)).to.be.true
    })
  
    it("Can replace USDC market in comptroller", async function(){
        const newMarket = await comptroller.markets(new_pUSDC.address);
        const oldMarket = await comptroller.markets(c.BRICKED_PUSDC_ADDRESS);
  
        expect(newMarket.isListed).to.be.true;
        expect(oldMarket.isListed).to.be.false;
  
        expect(await comptroller.mintGuardianPaused(new_pUSDC.address)).to.be.true;
        expect(await comptroller.borrowGuardianPaused(new_pUSDC.address)).to.be.true;
    });

    it("USDC Repaid funds can be redeemed by suppliers", async function() {
        const usdc = await hre.ethers.getContractAt(USDC_ABI, c.USDC_ADDRESS)
        const totalUnderlyingStart = await usdc.balanceOf(new_pUSDC.address) / 1e6;
        console.log("START total underlying usdc: ", totalUnderlyingStart);
        const usdcPrice =await chainlinkPriceOracle.getUnderlyingPrice(new_pUSDC.address) / 1e30;
        console.log(`Chainlink oracle price: $${usdcPrice}`); 

        await Promise.all(c.PUSDC_ACCOUNTS.map(repayUsdcLoan));
        const totalUnderlyingRepay = await usdc.balanceOf(new_pUSDC.address) / 1e6;
        console.log("REPAY total underlying usdc: ", totalUnderlyingRepay)
        await Promise.all(c.PUSDC_ACCOUNTS.map(redeemUsdc));
        const totalUnderlyingEnd = await usdc.balanceOf(new_pUSDC.address) / 1e6;
        console.log("END total underlying usdc: ", totalUnderlyingEnd)
    });

    it("ETH Repaid funds can be redeemed by suppliers", async function() {
        const totalUnderlyingStart = await hre.ethers.provider.getBalance(new_pETH.address) / 1e18;
        console.log("START total underlying ETH: ", totalUnderlyingStart);
        const ethPrice =await chainlinkPriceOracle.getUnderlyingPrice(new_pETH.address) / 1e18;
        console.log(`Chainlink oracle price: $${ethPrice}`); 

        await Promise.all(c.PETH_ACCOUNTS.map(repayEthLoan));
        const totalUnderlyingRepay = await hre.ethers.provider.getBalance(new_pETH.address) / 1e18;
        console.log("REPAY total underlying ETH: ", totalUnderlyingRepay)
        await Promise.all(c.PETH_ACCOUNTS.map(redeemEth));
        const totalUnderlyingEnd = await hre.ethers.provider.getBalance(new_pETH.address) / 1e18;
        console.log("END total underlying ETH: ", totalUnderlyingEnd)
    });
});