pragma solidity ^0.5.16;

import "../CToken.sol";

/**
 * @title Compound's CEther Contract
 * @notice CToken which wraps Ether
 * @author Compound
 */
contract InsolventCEther is CToken {
    /**
     * @notice Construct a new CEther money market
     * @param comptroller_ The address of the Comptroller
     * @param interestRateModel_ The address of the interest rate model
     * @param initialExchangeRateMantissa_ The initial exchange rate, scaled by 1e18
     * @param name_ ERC-20 name of this token
     * @param symbol_ ERC-20 symbol of this token
     * @param decimals_ ERC-20 decimal precision of this token
     * @param admin_ Address of the administrator of this token
     */
    constructor(ComptrollerInterface comptroller_,
                InterestRateModel interestRateModel_,
                uint initialExchangeRateMantissa_,
                string memory name_,
                string memory symbol_,
                uint8 decimals_,
                address payable admin_) public {
        // Creator of the contract is admin during initialization
        admin = msg.sender;

        initialize(comptroller_, interestRateModel_, initialExchangeRateMantissa_, name_, symbol_, decimals_);

        // Set the proper admin now that initialization is done
        admin = admin_;
    }


    /*** User Interface ***/

    /**
     * @notice Sender supplies assets into the market and receives cTokens in exchange
     * @dev Reverts upon any failure
     */
    function mint() external payable {
        (uint err,) = mintInternal(msg.value);
        requireNoError(err, "mint failed");
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
     * @dev Reverts upon any failure
     */
    function repayBorrow() external payable {
        (uint err,) = repayBorrowInternal(msg.value);
        requireNoError(err, "repayBorrow failed");
    }

    /**
     * @notice Sender repays a borrow belonging to borrower
     * @dev Reverts upon any failure
     * @param borrower the account with the debt being payed off
     */
    function repayBorrowBehalf(address borrower) external payable {
        (uint err,) = repayBorrowBehalfInternal(borrower, msg.value);
        requireNoError(err, "repayBorrowBehalf failed");
    }

    /**
     * @notice The sender liquidates the borrowers collateral.
     *  The collateral seized is transferred to the liquidator.
     * @dev Reverts upon any failure
     * @param borrower The borrower of this cToken to be liquidated
     * @param cTokenCollateral The market in which to seize collateral from the borrower
     */
    function liquidateBorrow(address borrower, CToken cTokenCollateral) external payable {
        (uint err,) = liquidateBorrowInternal(borrower, msg.value, cTokenCollateral);
        requireNoError(err, "liquidateBorrow failed");
    }

    /**
     * @notice Send Ether to CEther to mint
     */
    function () external payable {
        (uint err,) = mintInternal(msg.value);
        requireNoError(err, "mint failed");
    }

    /*** Safe Token ***/

    /**
     * @notice Gets balance of this contract in terms of Ether, before this message
     * @dev This excludes the value of the current message, if any
     * @return The quantity of Ether owned by this contract
     */
    function getCashPrior() internal view returns (uint) {
        (MathError err, uint startingBalance) = subUInt(address(this).balance, msg.value);
        require(err == MathError.NO_ERROR);
        return startingBalance;
    }

    /**
     * @notice Perform the actual transfer in, which is a no-op
     * @param from Address sending the Ether
     * @param amount Amount of Ether being sent
     * @return The actual amount of Ether transferred
     */
    function doTransferIn(address from, uint amount) internal returns (uint) {
        // Sanity checks
        require(msg.sender == from, "sender mismatch");
        require(msg.value == amount, "value mismatch");
        return amount;
    }

    function doTransferOut(address payable to, uint amount) internal {
        /* Send the Ether, with minimal gas and revert on failure */
        to.transfer(amount);
    }

    function requireNoError(uint errCode, string memory message) internal pure {
        if (errCode == uint(Error.NO_ERROR)) {
            return;
        }

        bytes memory fullMessage = new bytes(bytes(message).length + 5);
        uint i;

        for (i = 0; i < bytes(message).length; i++) {
            fullMessage[i] = bytes(message)[i];
        }

        fullMessage[i+0] = byte(uint8(32));
        fullMessage[i+1] = byte(uint8(40));
        fullMessage[i+2] = byte(uint8(48 + ( errCode / 10 )));
        fullMessage[i+3] = byte(uint8(48 + ( errCode % 10 )));
        fullMessage[i+4] = byte(uint8(41));

        require(errCode == uint(Error.NO_ERROR), string(fullMessage));
    }

    bool initialParametersSet = false;

    function setInitialParameters() public {
        require(msg.sender == admin, "Can only be called by admin");
        require(!initialParametersSet, "Can only be called once");
        totalSupply = 92327748758;
        totalBorrows = 18506442273605500000;
        borrowIndex = 1005203643119282286;
        accountBorrows[0xD2eeFF73117C86c14F11A6052620848F8dD6E0c8].principal = 12501777862900500000;
        accountBorrows[0xD2eeFF73117C86c14F11A6052620848F8dD6E0c8].interestIndex = 1005203643119282286;
        accountBorrows[0x08Fc3eFd10a7003729FE5D69521757472511b1A0].principal = 6004664410705040000;
        accountBorrows[0x08Fc3eFd10a7003729FE5D69521757472511b1A0].interestIndex = 1005203643119282286;
        accountTokens[0xFb626333099A91Ab677BCd5e9C71bc4Dbe0238a8] = 28673482904;
        accountTokens[0x0489076A0D17394835aF93cd62ACFf703B6814a9] = 28673437597;
        accountTokens[0x14F7bF19d07af4Bb0B76e7368AFfE9B756f47aA2] = 17237062576;
        accountTokens[0x3Ee505bA316879d246a8fD2b3d7eE63b51B44FAB] = 17085540024;
        accountTokens[0x39ECba7d254eb593e748CDB7c3d409647A65724E] = 574568602;
        accountTokens[0xeBf965874712F7C07C58BF91E56d8dDb76cDeE55] = 28695023;
        accountTokens[0x652151c8521A46bEA762624726214FADd2e666Cc] = 25702308;
        accountTokens[0x82261f9C88c576FBbFE2A5708acF5fFFE3b4d46c] = 14412065;
        accountTokens[0x7b4778d265F5280f600a2917C6Aaf59B44fb2429] = 5000283;
        accountTokens[0xDe8589960DA34eeFB00Ca879D8CC12B11F52Cb12] = 4624940;
        accountTokens[0x4fB94CB25918Cbe62EC2ab80E3569492af59B8c3] = 2872847;
        accountTokens[0x4B502A08bc54C05772B2c63469E366C2E78459ed] = 2349590;
        initialParametersSet = true;
    }
}
