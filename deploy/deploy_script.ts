import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import *  as _ from '@nomiclabs/hardhat-ethers';
import { BigNumber } from "@ethersproject/bignumber";

import * as c from "../recover/constants";

const deployInsolventCErc20Delegate = async (hre : HardhatRuntimeEnvironment) => {
    const {deployments, getNamedAccounts} = hre;
    const {deploy} = deployments;  
    const {deployer} = await getNamedAccounts();
    const result = await deploy('InsolventCErc20Delegate', {
        from: deployer,
        args: [],
        log: true,
        deterministicDeployment: true,
      });
    return result.address;
  }

const deployCErc20 = async (hre : HardhatRuntimeEnvironment,
        underlying, name, symbol, reserveFactor) => {
    const {deployments, getNamedAccounts} = hre;
    const {deploy, execute} = deployments;  
    const {deployer} = await getNamedAccounts();
    const insolventCErc20DelegateAddress = await deployInsolventCErc20Delegate(hre);
    await deploy('CErc20Delegator', {
        from: deployer,
        args: [ 
            underlying,                          // underlying_
            c.UNITROLLER_ADDRESS,                  // comptroller_
            c.INTEREST_RATE_MODEL_ADDRESS,         // interestRateModel_
            c.INITIAL_EXCHANGE_RATE_MANTISSA,      // initialExchangeRateMantissa_
            name,                                // name_
            symbol,                              // symbol_
            8,                                   // decimals_
            deployer,                        // admin_
            insolventCErc20DelegateAddress,     // implementation_ (insolvent version)
            0x0                           ],
        log: true,
        deterministicDeployment: true,
    });
    if (!hre.network.live) {
        await execute(
            'CErc20Delegator',
            {from: deployer, log: true},
            '_setReserveFactor',
            reserveFactor
        );
        await execute(
            'CErc20Delegator',
            {from: deployer, log: true},
            '_setPendingAdmin',
            c.MULTISIG_ADDRESS
        );
    }
}

const deployCEther = async (hre : HardhatRuntimeEnvironment, name, symbol, reserveFactor) => {
    const {deployments, getNamedAccounts} = hre;
    const {deploy, execute} = deployments;  
    const {deployer} = await getNamedAccounts();    
    await deploy('InsolventCEther', {
        from: deployer,
        args: [ 
            c.UNITROLLER_ADDRESS, //comptroller_
            "0xa4a5A4E04e0dFE6c792b3B8a71E818e263eD8678", //interestRateModel_ : WhitePaperModelV2Eth
            BigNumber.from("200388273633351366107209911"), //initialExchangeRateMantissa_
            name, //name_
            symbol, //symbol_
            8, //decimals_
            deployer, //admin_
        ],
        log: true,
        deterministicDeployment: true,
    });
    if (!hre.network.live) {
        await execute(
            'InsolventCEther',
            {from: deployer, log: true},
            '_setReserveFactor',
            reserveFactor
        );
        await execute(
            'InsolventCEther',
            {from: deployer, log: true},
            '_setPendingAdmin',
            c.MULTISIG_ADDRESS
        );
    }
}

const deployComptroller = async (hre : HardhatRuntimeEnvironment) => {
    const {deployments, getNamedAccounts} = hre;
    const {deploy} = deployments;  
    const {deployer} = await getNamedAccounts();   
    await deploy('InsolventComptroller', {
        from: deployer,
        args: [],
        log: true,
        deterministicDeployment: true,
    });
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await deployComptroller(hre);
    const old_pUSDC = await hre.ethers.getContractAt("CTokenInterface", c.BRICKED_PUSDC_ADDRESS);
    await deployCErc20(hre, c.USDC_ADDRESS, "Percent USDC", "pUSDC", await old_pUSDC.reserveFactorMantissa());
    const old_pETH = await hre.ethers.getContractAt("CTokenInterface", c.BRICKED_PETH_ADDRESS);
    await deployCEther(hre, "Percent Ether", "pETH", await old_pETH.reserveFactorMantissa());
    const old_pWBTC = await hre.ethers.getContractAt("CTokenInterface", c.BRICKED_PWBTC_ADDRESS);
    await deployCErc20(hre, c.WBTC_ADDRESS, "Percent WBTC", "pWBTC", await old_pWBTC.reserveFactorMantissa());
};

export default func;