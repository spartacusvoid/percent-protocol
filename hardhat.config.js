require("@nomiclabs/hardhat-ethers");
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
  }
};
