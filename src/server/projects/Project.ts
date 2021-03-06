import Levels from "./levels/index";
import Projects from ".";
import Story from "./story";
import { AnyFile } from "../parsers/pak/DataIndex";
import { ProjectInfo, ProjectMetaInfo, ProjectOsirisExtenderConfig } from "../../shared/notifications";
import { readFile } from "../../shared/fs";

export default class Project implements ProjectInfo {
  readonly levels: Levels;
  readonly meta: ProjectMetaInfo;
  readonly path: string;
  readonly osiExtenderConfig: ProjectOsirisExtenderConfig;
  readonly osiExtenderEnabled: boolean;
  readonly projects: Projects;
  readonly story: Story;

  constructor(projects: Projects, info: ProjectInfo) {
    this.levels = new Levels(this);
    this.meta = info.meta;
    this.path = info.path;
    this.osiExtenderConfig = info.osiExtenderConfig;
    this.osiExtenderEnabled = info.osiExtenderEnabled;
    this.projects = projects;
    this.story = new Story(this);
  }

  dispose() {
    this.story.dispose();
    this.levels.dispose();
  }

  getInfo(): ProjectInfo {
    return {
      meta: this.meta,
      path: this.path,
      osiExtenderConfig : this.osiExtenderConfig,
      osiExtenderEnabled : this.osiExtenderEnabled
    };
  }

  async initialize() {
    return this.story.initialize();
  }

  async load(file: AnyFile): Promise<string> {
    if (file.type === "local") {
      return readFile(file.path, { encoding: "utf-8" });
    } else {
      return this.projects.dataIndex.loadTextFile(file);
    }
  }
}
