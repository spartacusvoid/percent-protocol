import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import *  as _ from '@nomiclabs/hardhat-ethers';
import { BigNumber } from "@ethersproject/bignumber";

import * as c from "../recover/constants";

const deployCErc20 = async (hre : HardhatRuntimeEnvironment, 
        underlying: string, name: string, symbol: string,
        intreestRateModel : string) => {
    const {deployments, getNamedAccounts} = hre;
    const {deploy} = deployments;  
    const {deployer} = await getNamedAccounts();
    const insolventCErc20Delegate = await deploy('InsolventCErc20Delegate', {
        from: deployer,
        args: [],
        log: true,
        deterministicDeployment: true,
      })
    await deploy(symbol, {
        from: deployer,
        contract : "CErc20Delegator",
        args: [ 
            underlying,                          // underlying_
            c.UNITROLLER_ADDRESS,                  // comptroller_
            intreestRateModel,         // interestRateModel_
            c.INITIAL_EXCHANGE_RATE_MANTISSA,      // initialExchangeRateMantissa_
            name,                                // name_
            symbol,                              // symbol_
            8,                                   // decimals_
            c.MULTISIG_ADDRESS,                        // admin_
            insolventCErc20Delegate.address,     // implementation_ (insolvent version)
            0x0                           ],
        log: true,
        deterministicDeployment: true,
    });
}

const deployCEther = async (hre : HardhatRuntimeEnvironment, 
        name: string, symbol: string) => {
    const {deployments, getNamedAccounts} = hre;
    const {deploy} = deployments;  
    const {deployer} = await getNamedAccounts();    
    await deploy('pETH', {
        from: deployer,
        contract: 'InsolventCEther',
        args: [ 
            c.UNITROLLER_ADDRESS, //comptroller_
            c.INTEREST_RATE_MODELS.ETH, //interestRateModel_ 
            BigNumber.from("200388273633351366107209911"), //initialExchangeRateMantissa_
            name, //name_
            symbol, //symbol_
            8, //decimals_
            c.MULTISIG_ADDRESS, //admin_
        ],
        log: true,
        deterministicDeployment: true,
    });
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
    await deployCErc20(hre, c.USDC_ADDRESS, "Percent USDC", "pUSDC",
        c.INTEREST_RATE_MODELS.Stable1);
    await deployCEther(hre, "Percent Ether", "pETH");
    await deployCErc20(hre, c.WBTC_ADDRESS, "Percent WBTC", "pWBTC",
        c.INTEREST_RATE_MODELS.wBTC);
};

export default func;