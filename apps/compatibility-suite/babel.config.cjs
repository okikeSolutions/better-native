module.exports = function (api) {
  api.cache(true)
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "@babel/plugin-transform-object-rest-spread",
        { loose: false, useBuiltIns: false },
        "effect-safe-object-spread",
      ],
    ],
  }
}
