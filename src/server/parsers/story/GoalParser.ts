import msgInvalidOptionLocation from "./messages/msgInvalidOptionLocation";
import msgInvalidOptionName from "./messages/msgInvalidOptionName";
import msgInvalidOptionValue from "./messages/msgInvalidOptionValue";
import msgUnexpectedToken from "./messages/msgUnexpectedToken";
import ParserBase from "./Parser";
import { Diagnostic } from "./models/diagnostics";
import { NodeType, StoryGoalNode, AnyNode } from "./models/nodes";
import { TokenType, Token } from "./Lexer";

import isStoryToken, {
  StoryToken,
  storyTokenTypes
} from "./utils/isStoryToken";

export interface ParserResult {
  diagnostics: Array<Diagnostic>;
  goal: StoryGoalNode;
}

export default class GoalParser extends ParserBase {
  parse(): ParserResult {
    let storyToken: StoryToken | null;
    const goal: StoryGoalNode = {
      endOffset: 0,
      endPosition: 0,
      exit: null,
      init: null,
      kb: null,
      parentTargetEdges: [],
      subGoalCombiner: null,
      startOffset: 0,
      startPosition: 0,
      type: NodeType.StoryGoal,
      version: null
    };

    this.withBailOutTypes(storyTokenTypes, () => {
      do {
        switch (storyToken ? storyToken.type : null) {
          case TokenType.InitSectionKeyword:
            storyToken = this.readStoryInit(goal);
            break;
          case TokenType.KBSectionKeyword:
            storyToken = this.readStoryKB(goal);
            break;
          case TokenType.ExitSectionKeyword:
            storyToken = this.readStoryExit(goal);
            break;
          case TokenType.EndExitSectionKeyword:
            storyToken = this.readStoryOptions(goal, false);
            break;
          default:
            storyToken = this.readStoryOptions(goal, true);
        }
      } while (storyToken);
    });

    return {
      diagnostics: this.diagnostics,
      goal
    };
  }

  readStoryInit = this.withStoryBoundary(TokenType.KBSectionKeyword, goal => {
    return (goal.init = this.readActionBlock());
  });

  readStoryKB = this.withStoryBoundary(TokenType.ExitSectionKeyword, goal => {
    return (goal.kb = this.readRuleBlock());
  });

  readStoryExit = this.withStoryBoundary(
    TokenType.EndExitSectionKeyword,
    goal => {
      return (goal.exit = this.readActionBlock());
    }
  );

  readStoryOptions(goal: StoryGoalNode, isHeader: boolean): StoryToken | null {
    let token: Token | null;

    while ((token = this.next())) {
      if (isStoryToken(token)) {
        return token;
      } else if (token.type === TokenType.Identifier) {
        this.readStoryOption(goal, token, isHeader);
      } else {
        this.addDiagnostic(
          token,
          msgUnexpectedToken({
            actualToken: token
          })
        );
      }
    }

    return null;
  }

  readStoryOption(goal: StoryGoalNode, token: Token, isHeader: boolean) {
    const startOffset = token.startOffset;
    const startPosition = token.startPosition;
    let valueToken: Token | null;

    const headerCheck = (target: boolean) =>
      target !== isHeader
        ? this.addDiagnostic(
            token,
            msgInvalidOptionLocation({
              isHeader,
              name: token.value
            })
          )
        : null;

    switch (token.value) {
      case "Version":
        headerCheck(true);
        valueToken = this.read(TokenType.IntegerLiteral, true);
        if (valueToken) {
          const version = parseInt(valueToken.value);
          if (version !== 1) {
            this.addDiagnostic(
              token,
              msgInvalidOptionValue({
                actualValue: valueToken.value,
                expectedValue: "1",
                name: "Version"
              })
            );
          }

          goal.version = version;
        }
        break;

      case "SubGoalCombiner":
        headerCheck(true);
        valueToken = this.read(TokenType.Identifier, true);
        if (valueToken) {
          if (valueToken.value !== "SGC_AND") {
            this.addDiagnostic(
              valueToken,
              msgInvalidOptionValue({
                actualValue: valueToken.value,
                expectedValue: "SGC_AND",
                name: "SubGoalCombiner"
              })
            );
          }

          goal.subGoalCombiner = valueToken.value;
        }
        break;

      case "ParentTargetEdge":
        headerCheck(false);
        const name = this.readStringLiteral();
        if (name) {
          if (!goal.parentTargetEdges) {
            goal.parentTargetEdges = [];
          }

          goal.parentTargetEdges.push({
            endOffset: name.endOffset,
            endPosition: name.endPosition,
            name,
            startOffset,
            startPosition,
            type: NodeType.ParentTragetEdge
          });
        }
        break;

      default:
        this.addDiagnostic(token, msgInvalidOptionName({ name: token.value }));
    }
  }

  withStoryBoundary(
    boundaryType: TokenType,
    callback: {
      (goal: StoryGoalNode): AnyNode | null;
    }
  ) {
    return (goal: StoryGoalNode): StoryToken | null => {
      const last = this.last();
      let node: AnyNode | null;
      if (last) {
        const startOffset = last.startOffset;
        const startPosition = last.startPosition;

        node = callback(goal);
        if (node) {
          node.startOffset = startOffset;
          node.startPosition = startPosition;
        }
      } else {
        node = callback(goal);
      }

      const storyToken = this.readStoryBoundary();
      if (node && storyToken) {
        node.endOffset = storyToken.startOffset;
        node.endPosition = storyToken.startPosition;
      }

      if (storyToken && storyToken.type !== boundaryType) {
        this.addDiagnostic(
          storyToken,
          msgUnexpectedToken({
            actualToken: storyToken,
            expectedToken: boundaryType
          })
        );
      }

      return storyToken;
    };
  }
}
