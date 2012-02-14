"use strict";

var myrtle = require('myrtle-parser');
var _ = require('underscorem');

exports.parse = parse;
exports.parseType = parseType;
exports.stringize = stringizeSchema;

function parse(str, reservedTypeNames){
	_.assertLength(arguments, 2);
	_.assertObject(reservedTypeNames);
	
	var schema = myrtle.parse(str);
	schema = keratinize(schema, reservedTypeNames);
	return schema;
}

function startsWith(str, prefix){
	return str.indexOf(prefix) === 0;
}

var primitiveTypes = ['string', 'int', 'boolean', 'long', 'timestamp', 'binary', 'byte', 'bool'];
var primitiveTypesMap = {};
for(var i=0;i<primitiveTypes.length;++i){primitiveTypesMap[primitiveTypes[i]] = true;}
function isPrimitive(t){
	return primitiveTypesMap[t];
}

//parse a property's type (or the type of a set, list, or map element.)
function parseType(t){

	var colonIndex = t.indexOf(':');
	
	if(startsWith(t, 'set:')){
		return {type: 'set', members: parseType(t.substr(4))};
	}else if(startsWith(t, 'list:')){
		return {type: 'list', members: parseType(t.substr(5))};
	}else if(colonIndex !== -1){
		var keyType = t.substr(0, colonIndex);
		var valueType = t.substr(colonIndex+1);
		return {type: 'map', key: parseType(keyType), value: parseType(valueType)};
	}else if(isPrimitive(t)){
		if(t === 'bool') t = 'boolean';
		return {type: 'primitive', primitive: t};
	}else{
		return {type: 'object', object: t};
	}
}

//parse the properties of a keratin object type
function parseProperties(obj, rels, reservedTypeNames){
	_.each(rels, function(r){
		
		var rel = {
			name: r.tokens[0],
			type: parseType(r.tokens[1]),
			code: parseInt(r.tokens[2]),
			tags: {},
			properties: {},
			propertiesByCode: {}
		};
		
		if(reservedTypeNames.indexOf(rel.name.toLowerCase()) !== -1){
			_.errout('object property has reserved name: ' + rel.name);
		}
		
		if(r.tokens.length > 3){
			_.each(r.tokens.slice(3), function(t){
				rel.tags[t] = true;
			});
		}
		
		//'children' of rels are not allowed in the keratin format
		if(r.children.length > 0){
			_.errout('The keratin format only permits one level of indentation (properties may not have sub-properties.)');
		}
		
		obj.properties[r.tokens[0]] = rel;
		obj.propertiesByCode[rel.code] = rel;
	});
}

//parse a myrtle AST into a keratin schema
function keratinize(schema, reservedTypeNames){
	_.assertLength(arguments, 2);
	_.assertArray(reservedTypeNames);
	
	var result = {_byCode: {}};
	
	var takenCodes = {};
	
	_.each(schema.children, function(v){
		
		var code = v.tokens[1];

		if(takenCodes[code]){
			_.errout('object ' + v.tokens[0] + ' is using a code that is already taken: ' + code);
		}
		takenCodes[code] = true;
		var obj = {
			name: v.tokens[0],
			code: parseInt(code),
			superTypes: {},
			subTypes: {},
			properties: {},
			propertiesByCode: {}
		};

		if(reservedTypeNames.indexOf(obj.name) !== -1) _.errout('invalid name, reserved: ' + obj.name);
		
		if(v.tokens.length > 2){
			_.each(v.tokens.slice(2), function(t){
				obj.superTypes[t] = true;
			});
		}
		
		parseProperties(obj, v.children, reservedTypeNames);
		
		result[obj.name] = obj;
		result._byCode[obj.code] = obj;
	});
	
	return result;
}

//convert a keratin type into its string representation
function stringizeType(t, unknownTypeHandler){
	_.assertObject(t);

	if(t.type === 'set') return 'set:' + stringizeType(_.isString(t.members.type) ? t.members : t.members.type, unknownTypeHandler);
	if(t.type === 'list') return 'list:' + stringizeType(t.members, unknownTypeHandler);
	if(t.type === 'object') return t.object;
	
	if(t.type === 'map') return stringizeType(t.key, unknownTypeHandler) + ':' +  stringizeType(t.value, unknownTypeHandler);

	if(t.type === 'primitive'){
		if(!_.isString(t.primitive)){
			_.errout('cannot myrtlize type: ' + JSON.stringify(t));
		}
		_.assertString(t.primitive);
		return t.primitive;
	}else{
		var result = unknownTypeHandler(t);
		if(result === undefined) _.errout('no unknownTypeHandle found for: ' + JSON.stringify(t));
		_.assertDefined(result);
		return result;
	}
}

//convert a keratin schema (probably from another source) into its string representation.
function stringizeSchema(schema, name, code, unknownTypeHandler){
	_.assertLength(arguments, 4);
	
	var s = '';

	var entityTagStr = (schema.tags ? ' ' + _.keys(schema.tags).join(' ') : '');
	s += name + ' ' + code + entityTagStr + '\n';

	_.each(schema.properties, function(rel, relName){
		if(isNaN(parseInt(relName))){
			var tagStr = (rel.tags ? ' ' + _.keys(rel.tags).join(' ') : '');
			s += '\t' + relName + ' ' + stringizeType(rel.type, unknownTypeHandler) + ' ' + rel.code + tagStr + '\n';
		}
	});

	return s;
}
