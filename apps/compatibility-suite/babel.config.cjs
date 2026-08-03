module.exports = function (api) {
  api.cache(true)
  return {
    presets: [require.resolve("babel-preset-expo")],
    plugins: [
      [
        require.resolve("@babel/plugin-transform-object-rest-spread"),
        { loose: false, useBuiltIns: false },
        "effect-safe-object-spread",
      ],
    ],
  }
}
