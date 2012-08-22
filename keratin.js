"use strict";

var myrtle = require('myrtle-parser');
var _ = require('underscorem');

exports.parse = parse;
exports.parseType = parseType;
exports.stringize = stringizeSchema;

function parse(str, reservedTypeNames){
	_.assert(arguments.length >= 1);
	_.assert(arguments.length <= 2);
	reservedTypeNames = reservedTypeNames || [];
	_.assertArray(reservedTypeNames);
	
	
	var schema = myrtle.parse(str);
	//console.log('myrtle: ' + JSON.stringify(schema))
	schema = keratinize(schema, reservedTypeNames);
	return schema;
}

function startsWith(str, prefix){
	return str.indexOf(prefix) === 0;
}

var primitiveTypes = ['string', 'int', 'boolean', 'long', 'timestamp', 'binary', 'byte', 'bool', 'real', 'primitive'];
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
		_.assertDefined(t)
		_.assert(t !== 'undefined')
		return {type: 'object', object: t};
	}
}

//parse the properties of a keratin object type
function parseProperties(obj, rels, reservedTypeNames){

	var takenCodes = {};

	_.each(rels, function(r){
		
		_.assert(r.tokens.length >= 3)
		
		var rel = {
			name: r.tokens[0],
			type: parseType(r.tokens[1]),
			code: parseInt(r.tokens[2]),
			tags: {},
			properties: {},
			propertiesByCode: {}
		};
		
		if(takenCodes[rel.code] !== undefined){
			_.errout('object of type ' + obj.name + ' property code used more than once: ' + rel.name + ' ' + rel.code);
		}
		takenCodes[rel.code] = true;
		
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
		
		if(obj.properties[r.tokens[0]]) _.errout('duplicate property name "' + r.tokens[0] + '" for ' + obj.name)
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
	var codeNames = {}
	_.each(schema.children, function(v){
		
		var code = v.tokens[1];
		var name = v.tokens[0]

		
		if(name.indexOf('(') !== -1 || v.string.indexOf(':=') !== -1) return//TODO remove this coupling between minnow/shared/schema.js and keratin
		
		if(takenCodes[code] && codeNames[code] !== name){
			_.errout('object ' + name + ' is using a code that is already taken: ' + code);
		}
		codeNames[code] = name
		takenCodes[code] = true;
		var obj = {
			name: name,
			code: parseInt(code),
			superTypes: {},
			subTypes: {},
			properties: {},
			propertiesByCode: {}
		};

		//_.assertInt(obj.code)
		if(!_.isInt(obj.code)) _.errout('must provide integer code for object type: ' + name);

		if(reservedTypeNames.indexOf(obj.name) !== -1) _.errout('invalid name, reserved: ' + obj.name);
		
		if(v.tokens.length > 2){
			_.each(v.tokens.slice(2), function(t){
				obj.superTypes[t] = true;
			});
		}
		
		parseProperties(obj, v.children, reservedTypeNames);
		
		if(result[obj.name]){
			if(result[obj.name].code !== obj.code){
				_.errout('duplicate name already taken: ' + obj.name)	
			}else{
				_.each(obj.properties, function(prop, name){
					result[obj.name].properties[name] = prop
					result[obj.name].propertiesByCode[prop.code] = prop
				})				
			}
		}else{
			result[obj.name] = obj;
			result._byCode[obj.code] = obj;
		}
	});

	//check valid names for object property types
	_.each(result._byCode, function(v){
		_.each(v.properties, function(p, n){
		//	console.log('checking: ' + JSON.stringify(p))
			if(p.type.type === 'set' || p.type.type === 'list'){
				if(p.type.members.type === 'object'){
					if(result[p.type.members.object] === undefined) _.errout('object type referenced but not defined (in ' + v.name + '): ' + p.type.members.object)
				}
			}else if(p.type.type === 'map'){
				if(p.type.key.type === 'object'){
					if(result[p.type.key.object] === undefined) _.errout('object type referenced but not defined (in ' + v.name + '): ' + p.type.key.object)
				}
				if(p.type.value.type === 'object'){
					if(result[p.type.value.object] === undefined) _.errout('object type referenced but not defined (in ' + v.name + '): ' + p.type.value.object)
				}
			}else if(p.type.type === 'object'){
				if(result[p.type.object] === undefined) _.errout('object type referenced but not defined (in ' + v.name + '): ' + p.type.object)
			}
		})
	})
	
	function extendProperties(objSchema){
		_.each(objSchema.superTypes, function(dummy, sn){
			var st = result[sn];
			if(st){
				extendProperties(st);
				//_.extend(objSchema.properties, st.properties)
				_.each(st.properties, function(prop, key){
					if(objSchema.properties[key] === prop) return
					if(objSchema.properties[key]){
						_.errout('name collision between ' + objSchema.name + '.' + key + ' and super type\'s ' + st.name + '.' + key)
					}
					objSchema.properties[key] = prop
				})
				_.each(st.propertiesByCode, function(prop, key){
					if(objSchema.propertiesByCode[key] === prop) return
					if(objSchema.propertiesByCode[key]){
						_.errout('type code collision between ' + objSchema.name + '.' + objSchema.propertiesByCode[key].name + ' and super type property ' + st.name + '.' + prop.name + ', both use type code: ' + key)
					}
					objSchema.propertiesByCode[key] = prop
				})
				//_.extend(objSchema.propertiesByCode, st.propertiesByCode)
			}
		})
	}
	_.each(result._byCode, function(objSchema){
		extendProperties(objSchema)
	})	
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
