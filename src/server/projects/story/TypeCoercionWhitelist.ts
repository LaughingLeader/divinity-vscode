import Story from "./index";
import { ModData } from "../../parsers/pak/DataIndex";
import Symbol from "./Symbol";
import { readFile } from "../../../shared/fs";

export interface WhitelistFunction {
  name: string;
  numParameters: number;
  source?: string;
}

export default class TypeCoercionWhitelist {
  functions: Array<WhitelistFunction> = [];
  story: Story;

  constructor(story: Story) {
    this.story = story;
  }

  isWhitelisted(symbol: Symbol): boolean {
    return this.functions.some(
      f =>
        f.name === symbol.name &&
        f.numParameters === symbol.numParameters
    );
  }

  async loadLocal(path: string) {
    const data = await readFile(path, "UTF-8");
    this.parse(data);
  }

  parse(data: string, source?: string) {
    const functions = this.functions.filter(f => f.source !== source);
    const regexp = /^([A-Za-z0-9_-]+).*?(\d+)/gm;
    data = data.replace(/\r\n|\r/g, "\n");

    let match: RegExpExecArray | null = null;
    while ((match = regexp.exec(data))) {
      functions.push({
        name: match[1],
        numParameters: parseInt(match[2]),
        source
      });
    }

    this.functions = functions;
  }

  async loadDependency(mod: ModData) {
    if (!mod.typeCoercionWhitelist) {
      return;
    }

    const data = await this.story.project.load(mod.typeCoercionWhitelist);
    this.parse(data, mod.name);
  }

  removeLocal() {
    this.functions = this.functions.filter(f => !f.source);
  }
}
