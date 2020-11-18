require('hardhat-deploy');
require('hardhat-deploy-ethers');
const {ALCHEMY_API_KEY} = require("./secret")

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.5.16",
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
        blockNumber: 11254100
      }
    }
  },
  paths: {
    tests: "./recover/test"
  },
  namedAccounts: {
    deployer: {
      default: 0, // here this will by default take the first account as deployer
      1: 0, // similarly on mainnet it will take the first account as deployer. Note though that depending on how hardhat network are configured, the account 0 on one network can be different than on another
    }
  },
  mocha: {
    timeout: 60000
  }
};
