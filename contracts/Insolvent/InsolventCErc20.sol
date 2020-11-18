pragma solidity ^0.5.16;

/* import "./InsolventCToken.sol"; */
import "../CToken.sol";
import "../SafeMath.sol";

/**
 * @title Percent's InsolventCErc20 Contract
 * @notice CTokens which wrap an EIP-20 underlying
 * @author Percent
 */
/* contract InsolventCErc20 is InsolventCToken, CErc20Interface { */
contract InsolventCErc20 is CToken, CErc20Interface {
    /**
     * @notice Initialize the new money market
     * @param underlying_ The address of the underlying asset
     * @param comptroller_ The address of the Comptroller
     * @param interestRateModel_ The address of the interest rate model
     * @param initialExchangeRateMantissa_ The initial exchange rate, scaled by 1e18
     * @param name_ ERC-20 name of this token
     * @param symbol_ ERC-20 symbol of this token
     * @param decimals_ ERC-20 decimal precision of this token
     */
    function initialize(address underlying_,
                        ComptrollerInterface comptroller_,
                        InterestRateModel interestRateModel_,
                        uint initialExchangeRateMantissa_,
                        string memory name_,
                        string memory symbol_,
                        uint8 decimals_) public {//,
                        /* address original_, */
                        /* address[] memory holders_, */
                        /* address[] memory borrowers_) public { */
        // CToken initialize does the bulk of the work
        /* super.initialize(comptroller_, interestRateModel_, initialExchangeRateMantissa_, name_, symbol_, decimals_,original_,holders_,borrowers_); */
        super.initialize(comptroller_, interestRateModel_, initialExchangeRateMantissa_, name_, symbol_, decimals_);

        // Set underlying and sanity check it
        underlying = underlying_;
        EIP20Interface(underlying).totalSupply();
    }


    bool private _initState = false;

    function _specialInitState(address original, address[] memory accounts) public {
        require(!_initState, "may only _initState once");
        require(msg.sender == admin, "only admin may run _specialInitState");

        reserveFactorMantissa = CTokenInterface(original).reserveFactorMantissa();

        //We need to calculate the total negative and positive outlay after accounting for wash lending
        //These sums are required in the next loop to calculate each account's position
        uint totalPositiveOutlay = 0;
        uint totalNegativeOutlay = 0;
        for (uint8 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            (, uint supplied, uint borrowed, uint exchangeRateMantissa) =
                CTokenInterface(original).getAccountSnapshot(account);
            uint underlyingSupplied = SafeMath.div(SafeMath.mul(supplied, exchangeRateMantissa), 1e18);
            if (underlyingSupplied > borrowed) {
                uint outlay = SafeMath.sub(underlyingSupplied, borrowed);
                totalPositiveOutlay = totalPositiveOutlay + outlay;
            } else {
                uint outlay = SafeMath.sub(borrowed, underlyingSupplied);
                totalNegativeOutlay = totalNegativeOutlay + outlay;
            }
        }

        uint missingFunds = SafeMath.sub(totalPositiveOutlay, totalNegativeOutlay);

        uint hairCut = SafeMath.div(SafeMath.mul(missingFunds, 1e18),
                                    totalPositiveOutlay);

        uint multiplier = SafeMath.sub(1e18, hairCut);

        for (uint8 i = 0; i < accounts.length; i++) {
          address account = accounts[i];
          require(accountTokens[account] == 0, "should not have existing balance");

          (, uint supplied, uint borrowed, uint exchangeRateMantissa) =
            CTokenInterface(original).getAccountSnapshot(account);

          //If the account has supplied USDC, we calculate the total outlay, to account for wash lending
          if (supplied > 0) {
            uint underlyingSupplied = SafeMath.div(SafeMath.mul(supplied, exchangeRateMantissa), 1e18);
            //Positive outlay
            if (underlyingSupplied > borrowed) {
                uint outlay = SafeMath.sub(underlyingSupplied, borrowed);
                uint newUnderlyingSupplied = SafeMath.div(SafeMath.mul(outlay, multiplier), 1e18);
                uint newSupplied = SafeMath.div(SafeMath.mul(newUnderlyingSupplied, 1e18),exchangeRateMantissa);
                accountTokens[account] = newSupplied;
                totalSupply = SafeMath.add(totalSupply, newSupplied);
            }
            //Negative outlay
            else {
                uint outlay = SafeMath.sub(borrowed, underlyingSupplied);
                accountBorrows[account].principal = outlay;
                accountBorrows[account].interestIndex = borrowIndex;
                totalBorrows = SafeMath.add(totalBorrows, outlay);
            }
          }
          //The account has only borrowed, can be added as is
          else {
            accountBorrows[account].principal = borrowed;
            accountBorrows[account].interestIndex = borrowIndex;
            totalBorrows = SafeMath.add(totalBorrows, borrowed);
          }
        }

        _initState = true;
    }

    /*** User Interface ***/

    /**
     * @notice Sender supplies assets into the market and receives cTokens in exchange
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @param mintAmount The amount of the underlying asset to supply
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function mint(uint mintAmount) external returns (uint) {
        (uint err,) = mintInternal(mintAmount);
        return err;
    }

    /**
     * @notice Sender redeems cTokens in exchange for the underlying asset
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @param redeemTokens The number of cTokens to redeem into underlying
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function redeem(uint redeemTokens) external returns (uint) {
        return redeemInternal(redeemTokens);
    }

    /**
     * @notice Sender redeems cTokens in exchange for a specified amount of underlying asset
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @param redeemAmount The amount of underlying to redeem
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function redeemUnderlying(uint redeemAmount) external returns (uint) {
        return redeemUnderlyingInternal(redeemAmount);
    }

    /**
      * @notice Sender borrows assets from the protocol to their own address
      * @param borrowAmount The amount of the underlying asset to borrow
      * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
      */
    function borrow(uint borrowAmount) external returns (uint) {
        return borrowInternal(borrowAmount);
    }

    /**
     * @notice Sender repays their own borrow
     * @param repayAmount The amount to repay
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function repayBorrow(uint repayAmount) external returns (uint) {
        (uint err,) = repayBorrowInternal(repayAmount);
        return err;
    }

    /**
     * @notice Sender repays a borrow belonging to borrower
     * @param borrower the account with the debt being payed off
     * @param repayAmount The amount to repay
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function repayBorrowBehalf(address borrower, uint repayAmount) external returns (uint) {
        (uint err,) = repayBorrowBehalfInternal(borrower, repayAmount);
        return err;
    }

    /**
     * @notice The sender liquidates the borrowers collateral.
     *  The collateral seized is transferred to the liquidator.
     * @param borrower The borrower of this cToken to be liquidated
     * @param repayAmount The amount of the underlying borrowed asset to repay
     * @param cTokenCollateral The market in which to seize collateral from the borrower
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function liquidateBorrow(address borrower, uint repayAmount, CTokenInterface cTokenCollateral) external returns (uint) {
        (uint err,) = liquidateBorrowInternal(borrower, repayAmount, cTokenCollateral);
        return err;
    }

    /**
     * @notice The sender adds to reserves.
     * @param addAmount The amount fo underlying token to add as reserves
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function _addReserves(uint addAmount) external returns (uint) {
        return _addReservesInternal(addAmount);
    }

    /*** Safe Token ***/

    /**
     * @notice Gets balance of this contract in terms of the underlying
     * @dev This excludes the value of the current message, if any
     * @return The quantity of underlying tokens owned by this contract
     */
    function getCashPrior() internal view returns (uint) {
        EIP20Interface token = EIP20Interface(underlying);
        return token.balanceOf(address(this));
    }

    /**
     * @dev Similar to EIP20 transfer, except it handles a False result from `transferFrom` and reverts in that case.
     *      This will revert due to insufficient balance or insufficient allowance.
     *      This function returns the actual amount received,
     *      which may be less than `amount` if there is a fee attached to the transfer.
     *
     *      Note: This wrapper safely handles non-standard ERC-20 tokens that do not return a value.
     *            See here: https://medium.com/coinmonks/missing-return-value-bug-at-least-130-tokens-affected-d67bf08521ca
     */
    function doTransferIn(address from, uint amount) internal returns (uint) {
        EIP20NonStandardInterface token = EIP20NonStandardInterface(underlying);
        uint balanceBefore = EIP20Interface(underlying).balanceOf(address(this));
        token.transferFrom(from, address(this), amount);

        bool success;
        assembly {
            switch returndatasize()
                case 0 {                       // This is a non-standard ERC-20
                    success := not(0)          // set success to true
                }
                case 32 {                      // This is a compliant ERC-20
                    returndatacopy(0, 0, 32)
                    success := mload(0)        // Set `success = returndata` of external call
                }
                default {                      // This is an excessively non-compliant ERC-20, revert.
                    revert(0, 0)
                }
        }
        require(success, "TOKEN_TRANSFER_IN_FAILED");

        // Calculate the amount that was *actually* transferred
        uint balanceAfter = EIP20Interface(underlying).balanceOf(address(this));
        require(balanceAfter >= balanceBefore, "TOKEN_TRANSFER_IN_OVERFLOW");
        return balanceAfter - balanceBefore;   // underflow already checked above, just subtract
    }

    /**
     * @dev Similar to EIP20 transfer, except it handles a False success from `transfer` and returns an explanatory
     *      error code rather than reverting. If caller has not called checked protocol's balance, this may revert due to
     *      insufficient cash held in this contract. If caller has checked protocol's balance prior to this call, and verified
     *      it is >= amount, this should not revert in normal conditions.
     *
     *      Note: This wrapper safely handles non-standard ERC-20 tokens that do not return a value.
     *            See here: https://medium.com/coinmonks/missing-return-value-bug-at-least-130-tokens-affected-d67bf08521ca
     */
    function doTransferOut(address payable to, uint amount) internal {
        EIP20NonStandardInterface token = EIP20NonStandardInterface(underlying);
        token.transfer(to, amount);

        bool success;
        assembly {
            switch returndatasize()
                case 0 {                      // This is a non-standard ERC-20
                    success := not(0)          // set success to true
                }
                case 32 {                     // This is a complaint ERC-20
                    returndatacopy(0, 0, 32)
                    success := mload(0)        // Set `success = returndata` of external call
                }
                default {                     // This is an excessively non-compliant ERC-20, revert.
                    revert(0, 0)
                }
        }
        require(success, "TOKEN_TRANSFER_OUT_FAILED");
    }
}
