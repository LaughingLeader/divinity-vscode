import FileResource from "./FileResource";
import HeaderParser from "../../../parsers/story/HeaderParser";

import {
	HeaderNode,
	DefinitionNode
} from "../../../parsers/story/models/nodes";

export default class HeaderResource extends FileResource<HeaderNode> {
	public headerNode : HeaderNode | null = null;
	
	loadSync(noAnalysis?: boolean) {
		const source = this.getSourceSync();
		this.parse(source, noAnalysis);
	}
	
	isHeaderGoal(): boolean {
		return true;
	}
	
	protected async parse(
		source: string,
		noAnalysis?: boolean
		): Promise<HeaderNode> {
			const parser: HeaderParser = new HeaderParser(source);
			const { header } = parser.parse();
			this.headerNode = header;
			
			this.syncDefinitions(header.definitions);
			this.syncTypeAliases(header.typeAliases);
			
			this.story.symbols.update();
			return header;
		}
		
		private syncDefinitions(definitions: Array<DefinitionNode>) {
			const { symbols } = this.story;
			
			for (const definition of definitions) {
				symbols.addSystemSymbol(definition);
			}
		}
		
		private syncTypeAliases(aliases: Array<string>) {
			const { types } = this.story;
			for (const alias of aliases) {
				if (types.indexOf(alias) === -1) {
					types.push(alias);
				}
			}
		}
		
		removeLocal(originalHeader: HeaderResource|null) {
			if(this.headerNode != null) {
				if (originalHeader != null && originalHeader.headerNode != null) {
					let originalNode = originalHeader.headerNode;
					for (const definition of this.headerNode.definitions){
						if (originalNode.definitions.some(x => definition.signature.identifier.name === x.signature.identifier.name) == false) {
							//console.log("Removing symbol: " + definition.signature.identifier.name);
							this.story.symbols.removeSystemSymbol(definition);
						}
					}
				}
			}
		}
	}