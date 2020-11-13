const { Assertion, expect } = require("chai");
const c = require("../constants");
const { impersonateAccount, deployCErc20, deployComptroller } = require("../utils");
const USDC_ABI = require("../usdc_abi");
const { Zero } = ethers.constants
let tx, timelockSigner, new_pUSDC, old_pUSDC, comptroller, chainlinkPriceOracle

before(async function(){
  timelockSigner = await impersonateAccount(c.TIMELOCK_ADDRESS)
  const {c1, _ } = await deployComptroller(timelockSigner);
  comptroller = c1;
  old_pUSDC = await ethers.getContractAt("CTokenInterface", c.BRICKED_PUSDC_ADDRESS)
  new_pUSDC = await deployCErc20(c.USDC_ADDRESS, "Percent USDC", "pUSDC", await old_pUSDC.reserveFactorMantissa(), timelockSigner)
  comptroller = await hre.ethers.getContractAt("InsolventComptroller", c.UNITROLLER_ADDRESS, timelockSigner);
  chainlinkPriceOracle = await hre.ethers.getContractAt("ChainlinkPriceOracleProxy", c.CHAINLINK_PRICE_ORACLE_PROXY_ADDRESS, timelockSigner);
})

describe("Recovery", function () {
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
            console.log(e);
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