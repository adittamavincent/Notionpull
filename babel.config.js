module.exports = {
  presets: [
    ["@babel/preset-env", { targets: { node: "current" } }],
    ["@babel/preset-react", { runtime: "automatic" }],
    "@babel/preset-typescript",
  ],
  env: {
    development: {
      plugins: ["module:@locator/babel-jsx"],
    },
  },
};
