# Config

`Config` is a smart contract used by **twaper** to load required configurations for calculating price of a token. `Config` has two different implementations, one for getting required configurations for calculating price of a normal ERC20 token and another for a LP token.

## Contents

- [Deploy](#deploy)
- [Add a `Route`](#add-a-route)
- [Update a `Route`](#update-a-route)
- [Get `Route`s](#get-routes)

## Deploy

### ConfigFactory

`ConfigFactory` is a factory contract that is implemented to simplify deployment of `Config` contracts. It has two methods:

- `deployConfig` to deploy a config for a normal ERC20 token price calculation
- `deployLpConfig` to deploy a config for a LP token price calculation

No input is required to deploy the `ConfigFactory` itself, and any of the [methods for deploying a contract](https://ethereum.org/en/developers/docs/smart-contracts/deploying/#:~:text=To%20deploy%20a%20smart%20contract,contract%20without%20specifying%20any%20recipient.) can be used to do that.

It's not generally required to deploy the `ConfigFactory` yourself. It's deployed [?here](https://ftmscan.com/) and you can call its methods to deploy different `Config` instances for calculating price of different tokens.

### deployConfig

Deploying required `Config` for calculating price of a normal ERC20 token is as easy as calling `deployConfig` function on the [?`ConfigFactory`](https://ftmscan.com/). This method has the following inputs:

- `description` is a string to describe `Config` which is going to be deployed (e.g. `"ETH/USDC"` means `Config` contains routes can be used to calculate price of ETH in terms of USDC).
- `validPriceGap`  is the valid price difference percentage between differnt routes in scale of `1e18`.
- `setter` is the address that is authorized to update the `Config`.
- `admin` is the address of `Config`'s admin.

### deployLpConfig

Just like `Config`, deployment of a `LpConfig` is as simple as calling `deployLpConfig` function. This method has the following inputs:

- `chainId` is the chain id in which Lp token is deployed
- `pair` is the address of the Lp token
- `config0` is the address of the `Config` deployed for `token0`
- `config1` is the address of the `Config` deployed for `token1`
- `description` is a string to describe `LpConfig` which is going to be deployed (e.g. `"ETH-USDC LP Uniswap"` means `LpConfig` can be used to calculate price for ETH-USDC LP on Uniswap).
- `setter` is the address that is authorized to update the `Config`.
- `admin` is the address of `Config`'s admin.

## Add a `Route`

The most important configuration that a `Config` instance hosts is the list of routes that can be used to calculate the price of a normal ERC20 token. 
**twaper** calculates price of the token based on each route separately and then returns a weighted average as the result.

`addRoute` function can be used to add a new route to a `Config` instance. This method has the following inputs:

- `dex` is the name of the dex, the `Route` belongs to.
- `path` is an address array which contains pair addresses of the `Route`. E.x `[0xaF918eF5b9f33231764A5557881E6D3e5277d456, 0x2b4C76d0dc16BE1C31D4C1DC53bF9B45987Fc75c]` is [SpookySwap](https://spooky.fi/#/) route for [DEUS](https://deus.finance/) token. First is deusWftm address and second is wftmUsdc address.
- `config` is the `Config` should be considered during price calculation in **twaper**. `Config`'s type is `struct` and it has 8 members:

  - `chainId` is the chain id which the `Route` exists on.
  - `abiStyle` is the style of ABI of the dex of the `Route`. `UniV2`, `Solidly`, etc are valid values.
  - `reversed` is an array of booleans which are the indicator of the token that its price should be used in price calculation. E.x `[true, true]` is the right value for DEUS token route on SpookySwap.That means in **twaper**, price of token1 for both pairs on the `path` should be used which are DEUS and WFTM.
  - `fusePriceTolerance` is an array of `uint256`. Each element is the acceptable difference percentage between twap and fuse price of the corresponding pair. E.x `[3e17, 3e17]` means a gap of 30% between twap and fuse price of both pairs is acceptable. price of a pair means price of tokens in the pair in terms of the other token.
  - `minutesToSeed` is durations (in minutes) for which pairs twaps calculated.
  - `minutesToFuse` is durations (in minutes) for which pairs fuse prices calculated.
  - `weight` is weight of `Route` in twap calculation.
  - `isActive` is a boolean for showing `Route` status. `Routes` with `False` value don't participate in twap calculation.

**Routes can be added by `SETTER_ROLE` of the contract.**

## Update a `Route`

Updating a `Route` can be done in whole or in parts of it.

### Update `Route` in whole

`updateRoute` is the function handles this. Inputs are the same as `addRoute` except `index` which is the the index of the `Route` should be updated.

### Update `Route` in parts

Multiple functions defined for this purpose:

- `setFusePriceTolerance`
- `setMinutesToSeed`
- `setMinutesToFuse`
- `setWeight`
- `setIsActive`

Each of them get `index` of the `Route` and new value for the variable needed to be updated.

**Routes can be updated by `SETTER_ROLE` of the contract.**

## Get `Route`s

All `Route`s of `Config` can be gotten by calling `getRoutes` function. No inputs needed and it returns `validPriceGap` and array of `Route`.
