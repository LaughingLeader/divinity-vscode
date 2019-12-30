import { readFileSync } from "fs";

export default function readFile<T = any>(path: string): T | null {
	try {
	  const source = readFileSync(path, { encoding: "utf-8" });
	  return JSON.parse(source) as T;
	} catch (error) {
	  return null;
	}
  }