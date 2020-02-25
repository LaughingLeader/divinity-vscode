import didParametersChange from "./utils/didParametersChange";
import getAnnotatedType from "./utils/getAnnotatedType";
import getCallerSymbolType from "./utils/getCallerSymbolType";
import getDefinitionSort from "./utils/getDefinitionSort";
import getDefinitionSymbolType from "./utils/getDefinitionSymbolType";
import getParameterNameScore from "./utils/getParameterNameScore";
import Goal from "./Goal";
import isDefinitionListEqual from "./utils/isDefinitionListEqual";
import isGoalListEqual from "./utils/isGoalListEqual";
import parseDocComments from "./utils/parseDocComment";
import Symbols from "./Symbols";
import toParameters from "./utils/toParameters";
import { CallerNode } from "../../parsers/story/utils/isCallerNode";
import { EachCallerType } from "../../parsers/story/utils/eachCaller";
import { EnumerationMap } from "./Enumerations";
import { SymbolType, SymbolDoc, Variable } from "./models/symbol";
import { TokenRange } from "../../parsers/story/Lexer";

import resolveParameters, {
  ResolvePrameterResult
} from "./utils/resolveParameters";

import {
  Parameter,
  ParameterType,
  ScoredParameterName
} from "./models/parameter";

import {
  NodeType,
  IdentifierType,
  DefinitionNode,
  ParameterFlow
} from "../../parsers/story/models/nodes";

export interface SymbolDefinition extends TokenRange {
  comment: string | null;
  goal: Goal;
  isInferred: boolean;
  isPartial: boolean;
  parameters: Array<Parameter>;
  type: SymbolType;
}

export interface SymbolState {
  dbReads?: Array<Goal> | null;
  dbWrites?: Array<Goal> | null;
  definitions?: Array<SymbolDefinition>;
  symbol: Symbol;
}

export default class Symbol {
  category: string | null = null;
  dbReads: Array<Goal> | null = null;
  dbWrites: Array<Goal> | null = null;
  definitions: Array<SymbolDefinition> = [];
  documentation: SymbolDoc | null = null;
  isDead: boolean = false;
  isSystem: boolean = false;
  needsUpdate: boolean = false;
  parameters: Array<Parameter>;
  parameterNames: Array<ScoredParameterName>;
  resolvedDefinition: SymbolDefinition | null = null;
  type: SymbolType = SymbolType.Unknown;
  isWhitelisted: boolean = false;

  readonly name: string;
  readonly numParameters: number;
  readonly searchName: string;
  readonly symbols: Symbols;
  readonly usages: Array<Goal> = [];

  constructor(symbols: Symbols, name: string, numParameters: number) {
    this.symbols = symbols;

    const parameters: Array<Parameter> = [];
    const parameterNames: Array<ScoredParameterName> = [];

    for (let index = 0; index < numParameters; index++) {
      const name = `_Param${index + 1}`;
      parameterNames.push({ name, score: 0 });
      parameters.push({
        flow: null,
        fromIndex: null,
        fromSymbol: null,
        name,
        type: ParameterType.Unknown
      });
    }

    this.name = name;
    this.numParameters = numParameters;
    this.parameters = parameters;
    this.parameterNames = parameterNames;
    this.searchName = name.toLowerCase();
  }

  applyTo(node: CallerNode, type: EachCallerType, variables: Array<Variable>) {
    if (type === EachCallerType.Fact) {
      return;
    }

    const { parameters } = node.signature;
    if (parameters.length !== this.numParameters) {
      throw new Error("Invalid operation.");
    }

    for (let index = 0; index < parameters.length; index++) {
      const parameter = parameters[index];
      const { argument } = parameter;
      if (
        argument.type !== NodeType.Identifier ||
        argument.identifierType !== IdentifierType.Variable
      ) {
        continue;
      }

      const definition = this.parameters[index];
      if (definition && definition.flow === ParameterFlow.In) {
        continue;
      }

      const annotatedType = getAnnotatedType(parameter.valueType);
      const name = argument.name.toLowerCase();
      const variable: Variable = {
        displayName: argument.name,
        enumeration: this.parameters[index].enumeration,
        fromIndex: index,
        fromSymbol: this,
        name,
        type: annotatedType || this.parameters[index].type
      };

      const existingIndex = variables.findIndex(
        variable => variable.name === name
      );

      if (existingIndex === -1) {
        variables.push(variable);
      }
    }
  }

  addDatabaseAccess(goal: Goal, node: CallerNode) {
    let { dbReads, dbWrites } = this;

    if (
      (node.type === NodeType.Rule ||
        node.type === NodeType.SignatureCondition) &&
      (!dbReads || dbReads.indexOf(goal) === -1)
    ) {
      if (!dbReads) {
        dbReads = this.dbReads = [];
      }

      dbReads.push(goal);
    }

    if (
      node.type === NodeType.SignatureAction &&
      !node.isInverted &&
      (!dbWrites || dbWrites.indexOf(goal) === -1)
    ) {
      if (!dbWrites) {
        dbWrites = this.dbWrites = [];
      }

      dbWrites.push(goal);
    }
  }

  addReference(
    goal: Goal,
    node: CallerNode,
    type: EachCallerType,
    variables?: Array<Variable>
  ) {
    const { definitions, parameterNames, usages } = this;
    const { identifierType } = node.signature.identifier;
    const isDefinition =
      !this.isSystem &&
      (identifierType === IdentifierType.Database ||
        type === EachCallerType.Definition);

    if (usages.indexOf(goal) === -1) {
      usages.push(goal);
    }

    if (identifierType === IdentifierType.Database) {
      this.addDatabaseAccess(goal, node);
    }

    const { parameters } = node.signature;
    for (let index = 0; index < parameters.length; index++) {
      const { argument } = parameters[index];
      const parameter = this.parameters[index];

      if (
        argument.type === NodeType.Identifier &&
        argument.identifierType === IdentifierType.Variable
      ) {
        const score = getParameterNameScore(argument.name);
        if (score > parameterNames[index].score) {
          parameterNames[index].score = score;
          parameterNames[index].name = argument.name;
        }
      }

      if (
        parameter.enumeration &&
        (argument.type === NodeType.StringLiteral ||
          argument.type === NodeType.IntegerLiteral)
      ) {
        parameter.enumeration.addValue(goal, argument);
      }
    }

    if (isDefinition && !this.hasCompleteDefinition(goal)) {
      const parameters = toParameters(this, node.signature, variables);
      definitions.push({
        ...parameters,
        comment: node.type === NodeType.Rule ? node.comment : null,
        endOffset: node.endOffset,
        endPosition: node.endPosition,
        goal,
        startOffset: node.startOffset,
        startPosition: node.startPosition,
        type: getCallerSymbolType(node)
      });

      this.needsUpdate = true;
    }
  }

  getEnumMap(): EnumerationMap {
    return this.symbols.story.enumerations.findSymbolEnums(this.searchName);
  }

  hasCompleteDefinition(target: Goal): boolean {
    return this.definitions.some(
      ({ goal, isInferred, isPartial }) =>
        goal === target && !isInferred && !isPartial
    );
  }

  invalidate(state: SymbolState) {
    if (
      !isGoalListEqual(this.dbReads, state.dbReads) ||
      !isGoalListEqual(this.dbWrites, state.dbWrites)
    ) {
      this.invalidateUsage();
    }

    if (!isDefinitionListEqual(this.definitions, state.definitions)) {
      this.needsUpdate = true;
    }
  }

  invalidateUsage() {
    for (const usage of this.usages) {
      usage.resource.invalidate();
    }
  }

  isDefinedBy(goal: Goal): boolean {
    return this.definitions.some(definition => definition.goal === goal);
  }

  notifyGoalChanged(goal: Goal) {
    if (this.isDefinedBy(goal)) {
      this.needsUpdate = true;
    }
  }

  removeGoal(goal: Goal): SymbolState | null {
    const { definitions, usages, dbReads, dbWrites } = this;
    const result: SymbolState = {
      dbReads: this.dbReads,
      dbWrites: this.dbWrites,
      definitions: this.definitions,
      symbol: this
    };

    let hasChanged = false;
    let index = usages.indexOf(goal);
    if (index !== -1) {
      usages.splice(index, 1);
    }

    if (dbWrites) {
      index = dbWrites.indexOf(goal);
      if (index !== -1) {
        result.dbWrites = dbWrites.slice();
        dbWrites.splice(index, 1);
        hasChanged = true;
      }

      if (dbWrites.length === 0) {
        this.dbWrites = null;
      }
    }

    if (dbReads) {
      index = dbReads.indexOf(goal);
      if (index !== -1) {
        result.dbReads = dbReads.slice();
        dbReads.splice(index, 1);
        hasChanged = true;
      }

      if (dbReads.length === 0) {
        this.dbReads = null;
      }
    }

    if (this.isDefinedBy(goal)) {
      hasChanged = true;
      this.definitions = definitions.filter(
        definition => definition.goal !== goal
      );
    }

    return hasChanged ? result : null;
  }

  resetParameters(force:boolean = false) {
    if (this.isSystem && !force) {
      console.error("Trying to reset system definition.");
      return;
    }

    const { numParameters, parameterNames } = this;
    const parameters: Array<Parameter> = [];

    for (let index = 0; index < numParameters; index++) {
      parameters.push({
        flow: null,
        fromIndex: null,
        fromSymbol: null,
        name: parameterNames[index].name,
        type: ParameterType.Unknown
      });
    }

    this.parameters = parameters;
    this.resolvedDefinition = null;
    this.invalidateUsage();
  }

  toSystemSymbol(definition: DefinitionNode) {
    const { parameters } = toParameters(this, definition.signature);

    this.type = getDefinitionSymbolType(definition);
    this.isSystem = true;
    this.parameters = parameters;
  }

  update(force:boolean = false) {
    const { definitions, isSystem, dbWrites } = this;
    if (isSystem && !force) {
      console.error("Trying to rebuild system definition.");
      this.needsUpdate = false;
      return;
    }

    let deadCounter = 0;
    definitions.sort(getDefinitionSort);

    this.type = SymbolType.Unknown;

    for (const definition of definitions) {
      const parameters = resolveParameters(this, definition);
      if (Array.isArray(parameters)) {
        if (didParametersChange(this.parameters, parameters)) {
          this.invalidateUsage();
        }

        this.isDead = false;
        this.needsUpdate = false;
        this.parameters = parameters;
        this.resolvedDefinition = definition;
        this.type = definition.type;
        this.documentation = definition.comment
          ? parseDocComments(definition.comment)
          : null;

        return;
      }

      if (this.type === SymbolType.Unknown) {
        this.type = definition.type;
      }

      if (parameters === ResolvePrameterResult.Dead) {
        deadCounter += 1;
      }
    }

    this.isWhitelisted = this.symbols.story.typeCoercionWhitelist.isWhitelisted(this);
  
    if (
      this.type === SymbolType.Database &&
      (!dbWrites || dbWrites.length === 0 || deadCounter === definitions.length)
    ) {
      this.isDead = true;
      this.needsUpdate = false;
    }

    this.resetParameters(force);
  }

  static fromCaller(symbols: Symbols, caller: CallerNode): Symbol {
    const { signature } = caller;
    const symbol = new Symbol(
      symbols,
      signature.identifier.name,
      signature.parameters.length
    );
    symbol.isWhitelisted = symbol.symbols.story.typeCoercionWhitelist.isWhitelisted(symbol);

    return symbol;
  }

  static fromDefinition(symbols: Symbols, definition: DefinitionNode): Symbol {
    const { signature } = definition;
    const symbol = new Symbol(
      symbols,
      signature.identifier.name,
      signature.parameters.length
    );
    symbol.toSystemSymbol(definition);
    symbol.isWhitelisted = symbol.symbols.story.typeCoercionWhitelist.isWhitelisted(symbol);
    return symbol;
  }
}
