import { BigNumber } from "bignumber.js";
import moment from "moment";
import pg from "pg";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parseByteA = require("postgres-bytea");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parseArray = require('postgres-array');

//------------------------------------------------------------------------------

interface IArrayParser {
	parse: () => any;
}

//------------------------------------------------------------------------------

let initialized = false;

//------------------------------------------------------------------------------

export function registerParsers(): void {
	if (!initialized) {
		pg.types.setTypeParser(pg.types.builtins.DATE, parseDbDate);
		pg.types.setTypeParser(pg.types.builtins.TIME, parseDbDate);
		pg.types.setTypeParser(pg.types.builtins.TIMETZ, parseDbDate);
		pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, parseDbDate);
		pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, parseDbDate);
		pg.types.setTypeParser(1182, parseDbDateArray); // _date
		pg.types.setTypeParser(1183, parseDbDateArray); // _time
		pg.types.setTypeParser(1270, parseDbDateArray); // _timetz
		pg.types.setTypeParser(1115, parseDbDateArray); // _timestamp
		pg.types.setTypeParser(1185, parseDbDateArray); // _timestamptz

		pg.types.setTypeParser(pg.types.builtins.INT2, "text", parseDbInteger);
		pg.types.setTypeParser(pg.types.builtins.INT4, "text", parseDbInteger);
		pg.types.setTypeParser(pg.types.builtins.INT8, "text", parseDbBigInteger);
		pg.types.setTypeParser(1005, parseDbIntegerArray); // _int2
		pg.types.setTypeParser(1007, parseDbIntegerArray); // _int4
		pg.types.setTypeParser(1016, parseDbBigIntegerArray); // _int8

		pg.types.setTypeParser(pg.types.builtins.FLOAT4, "text", parseDbFloat);
		pg.types.setTypeParser(pg.types.builtins.FLOAT8, "text", parseDbFloat);
		pg.types.setTypeParser(pg.types.builtins.NUMERIC, "text", parseDbBigFloat);
		pg.types.setTypeParser(pg.types.builtins.MONEY, "text", parseDbBigFloat);
		pg.types.setTypeParser(1021, parseDbFloatArray); // _float4
		pg.types.setTypeParser(1022, parseDbBigFloatArray); // _float8
		pg.types.setTypeParser(1231, parseDbBigFloatArray); // _numeric
		pg.types.setTypeParser(791, parseDbBigFloatArray); // _money

		pg.types.setTypeParser(pg.types.builtins.BOOL, "text", parseDbBool);
		pg.types.setTypeParser(1000, parseDbBoolArray);

		pg.types.setTypeParser(pg.types.builtins.BYTEA, "binary", parseByteA);
		pg.types.setTypeParser(1001, parseByteAArray);

		initialized = true;
	}
}

//------------------------------------------------------------------------------
// Private functions

function parseDbDate(val: string): any {
	return val !== null ? moment.utc(val) : null;
}

function parseDbDateArray(val: string): any {
	if (val === null) {
		return null;
	}
	return createArrayParser(val, parseDbDate);
}

function parseDbInteger(val: string): any {
	if (val === null) {
		return null;
	}
	return parseInt(val, 10);
}

function parseDbIntegerArray(val: string): any {
	if (val === null) {
		return null;
	}
	return createArrayParser(val, parseDbInteger);
}

function parseDbBigInteger(val: string): any {
	if (val === null) {
		return null;
	}
	try {
		const value = parseInt(val, 10);
		if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
			return value;
		}
	}
	catch (err) {
		// Keep ESLint happy
	}
	// Try bigint as a last chance
	return BigInt(val);
}

function parseDbBigIntegerArray(val: string): any {
	if (val === null) {
		return null;
	}
	return createArrayParser(val, parseDbBigInteger);
}

function parseDbFloat(val: string): any {
	if (val === null) {
		return null;
	}
	return parseFloat(val);
}

function parseDbFloatArray(val: string): any {
	if (val === null) {
		return null;
	}
	return createArrayParser(val, parseDbFloat);
}

function parseDbBigFloat(val: string): any {
	if (val === null) {
		return null;
	}
	const bn = new BigNumber(val);
	return bn;
}

function parseDbBigFloatArray(val: string): any {
	if (val === null) {
		return null;
	}
	return createArrayParser(val, parseDbBigFloat);
}

function parseDbBool(val: string): any {
	if (val === null) {
		return null;
	}
	return val === 'TRUE' || val === 't' || val === 'true' || val === 'y' || val === 'yes' || val === 'on' || val === '1';
}

function parseDbBoolArray(val: string): any {
	if (val === null) {
		return null;
	}
	return createArrayParser(val, parseDbBool);
}

function parseByteAArray(val: string): any {
	if (val === null) {
		return null;
	}
	return createArrayParser(val, parseByteA);
}

function createArrayParser(value: string, transform: (entry: string) => any): IArrayParser {
	return {
		parse: function(): any {
			return parseArray.parse(value, (entry: string) => {
				if (entry === null) {
					return null;
				}
				return transform(entry);
			});
		}
	};
}
