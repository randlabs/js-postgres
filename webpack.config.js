/* eslint-disable no-empty-function */
const path = require("path");
const fs = require("fs");
const webpack = require("webpack");
const TerserPlugin = require("terser-webpack-plugin");
const DtsBundler = require("dts-bundle-generator");

// -----------------------------------------------------------------------------

module.exports = {
	mode: "production",
	target: "node",
	entry: "./src/index.ts",
	output: {
		filename: "index.js",
		path: path.resolve(__dirname, "build"),
		library: {
			type: "commonjs2"
		}
	},
	module: {
		rules: [
			{
				test: /\.ts$/u,
				include: path.resolve(__dirname, "src"),
				use: [
					{
						loader: 'ts-loader'
					}
				]
			}
		]
	},
	resolve: {
		extensions: [ '.ts', '.js' ]
	},
	externals: {
		pg: 'pg',
		moment: 'moment',
		bignumber: 'bignumber.js'
	},
	devtool: 'source-map',
	optimization: {
		minimize: true,
		minimizer: [
			new TerserPlugin({
				extractComments: false,
				terserOptions: {
					ecma: 2015,
					format: {
						comments: false,
					}
				}
			})
		]
	},
	plugins: [
		new webpack.IgnorePlugin({
			resourceRegExp: /pg-native/u
		}),
		new DtsBundlerPlugin()
	]
};

// -----------------------------------------------------------------------------

function DtsBundlerPlugin() {}

DtsBundlerPlugin.prototype.apply = function(compiler) {
	compiler.hooks.afterEmit.tap(
		"DtsBundlerPlugin",
		(compilation) => {
			if (compilation.options.entry.main.import.length > 0) {
				const output = DtsBundler.generateDtsBundle([
					{
						filePath: compilation.options.entry.main.import[0],
						output: {
							//umdModuleName: "pgm",
							noBanner: true,
							inlineDeclareGlobals: true
						},
						libraries: {
							allowedTypesLibraries: []
						}
					}
				], {});

				fs.writeFileSync(
					path.resolve(
						compilation.options.output.path + path.sep,
						"." + path.sep + "index.d.ts"
					),
					output[0]
				);
			}
		}
	);
};
