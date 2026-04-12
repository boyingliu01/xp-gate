import { FunctionInfo, ClassInfo, FieldInfo, ParameterInfo, LanguageAdapter } from '../types.js';

/**
 * Language adapter for Go files.
 * 
 * Uses AST parsing to extract code constructs like functions, 
 * methods, parameters, and complexity metrics.
 */

export const getFileExtensions = (): string[] => ['.go'];

export const parseAST = async (sourceCode: string): Promise<any> => {
  // For this initial implementation, we return a simple representation
  // In practice, we would integrate with go's AST package through a bridge
  return { code: sourceCode, type: 'stub' };
};

export const extractFunctions = (ast: any): FunctionInfo[] => {
  const functions: FunctionInfo[] = [];
  
  try {
    if (!ast || !ast.code) {
      return functions;
    }
    
    const lines = ast.code.split('\n');
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i].trim();
      
      // Go function declarations start with 'func' keyword
      if (line.startsWith('func ')) {
        let startLine = i + 1;
        
        // Extract function info
        const funcMatch = line.match(/^func\s+(?:\([^)]+\)\s+)?([^\s(]+)\s*(\([^\)]*\))/);
        
        if (funcMatch) {
          const name = funcMatch[1].trim();
          const paramsStr = funcMatch[2] || '';
          
          // Find function end - Go uses curly braces for blocks
          let braceDepth = 0;
          let endLine = startLine;
          let foundOpeningBrace = false;
          
          for (let j = i; j < lines.length; j++) {
            const currentLine = lines[j];
            let inString = false;
            let escaped = false;
            
            for (let k = 0; k < currentLine.length; k++) {
              const char = currentLine[k];
              
              if (escaped) {
                escaped = false;
                continue;
              }
              
              if (char === '\\') {
                escaped = true;
                continue;
              }
              
              if (char === '"' || char === '`') {
                inString = !inString;
                continue;
              }
              
              if (inString) continue;
              
              if (char === '{') {
                if (!foundOpeningBrace) foundOpeningBrace = true;
                braceDepth++;
              } else if (char === '}') {
                braceDepth--;
                
                // If we've closed the initial opening brace
                if (braceDepth === 0 && foundOpeningBrace) {
                  endLine = j + 1;
                  break;
                }
              }
            }
            
            if (braceDepth === 0 && foundOpeningBrace) {
              endLine = j + 1;
              break;
            }
            
            if (j === lines.length - 1) {
              endLine = j + 1;
            }
          }
          
          // Parse parameters from the function signature
          const parameters = parseGoParameters(paramsStr);
          
          // Calculate line of code count, excluding comments and empty lines
          let linesOfCode = 0;
          for (let idx = startLine; idx < endLine - 1; idx++) {  // startLine is declaration, endLine contains closing bracket
            const lineContent = lines[idx];
            if (isEmptyOrComment(lineContent)) {
              continue;
            }
            linesOfCode++;
          }
          
          // Go doesn't have deep nesting like other languages, simplified calculation
          const nestingDepth = calculateNestingDepth(lines, i, endLine);
          
          // Compute complexity
          const complexity = calculateCyclomaticComplexityGo(lines, i, endLine);
          
          const funcInfo: FunctionInfo = {
            name,
            startLine,
            endLine,
            parameters,
            nestingDepth,
            complexity,
            linesOfCode,
            sourceCode: lines.slice(i, endLine).join('\n')
          };
          
          functions.push(funcInfo);
        }
      }
      
      i++;
    }
  } catch (e) {
    console.error('Error extracting Go functions:', e);
  }
  
  return functions;
};

export const extractClasses = (ast: any): ClassInfo[] => {
  // Go doesn't have classes, but it has structs with associated methods
  // Treating structs as "classes" for analysis purposes
  const classes: ClassInfo[] = [];
  
  try {
    if (!ast || !ast.code) {
      return classes;
    }
    
    const lines = ast.code.split('\n');
    
    // Find struct definitions
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for type X struct definition
      if (/^type\s+(\w+)\s+struct\s*\{?/.test(line)) {
        const match = line.match(/^type\s+(\w+)\s+struct/);
        if (match) {
          const structName = match[1];
          const startLine = i + 1;
          
          // Find struct end (closing brace) for inline definitions
          let endLine = startLine;
          
          // If the struct opening brace is on the same line, find its matching brace
          let braceCount = 0;
          let inStruct = line.includes('{');
          
          if (inStruct) {
            // Search for the closing brace
            braceCount = (line.match(/\{/g) || []).length;
            braceCount -= (line.match(/\}/g) || []).length;
            
            if (braceCount <= 0) {
              // Struct definition might end on this line
              continue;
            }
            
            for (let j = i + 1; j < lines.length; j++) {
              const currentLine = lines[j];
              if (!currentLine.includes('//')) {
                const openBraces = (currentLine.match(/\{/g) || []).length;
                const closeBraces = (currentLine.match(/\}/g) || []).length;
                braceCount += openBraces - closeBraces;
                
                if (braceCount <= 0) {
                  endLine = j + 1;
                  break;
                }
              }
              endLine = j + 1;
            }
          }
          
          // Now find associated methods for this struct
          const methods: FunctionInfo[] = [];
          
          // Search the file for methods associated with this struct
          for (let j = 0; j < lines.length; j++) {
            const methodLine = lines[j].trim();
            
            // Check if this is a method signature for our struct
            // Format is: func (s *StructName) MethodName(args) returnType
            if (methodLine.startsWith('func ') && methodLine.includes(`(${structName}`) || methodLine.includes(`(*${structName}`)) {
              const methodStartLine = j + 1;
              
              // Find the end of this method (same as function detection)
              let methodBraceDepth = 0;
              let methodEndLine = methodStartLine;
              let foundMethodOpeningBrace = false;
              
              for (let k = j; k < lines.length; k++) {
                const currentLine = lines[k];
                let inString = false;
                let escaped = false;
                
                for (let l = 0; l < currentLine.length; l++) {
                  const char = currentLine[l];
                  
                  if (escaped) {
                    escaped = false;
                    continue;
                  }
                  
                  if (char === '\\') {
                    escaped = true;
                    continue;
                  }
                  
                  if (char === '"' || char === '`') {
                    inString = !inString;
                    continue;
                  }
                  
                  if (inString) continue;
                  
                  if (char === '{') {
                    if (!foundMethodOpeningBrace) foundMethodOpeningBrace = true;
                    methodBraceDepth++;
                  } else if (char === '}') {
                    methodBraceDepth--;
                    
                    if (methodBraceDepth === 0 && foundMethodOpeningBrace) {
                      methodEndLine = k + 1;
                      break;
                    }
                  }
                }
                
                if (methodBraceDepth === 0 && foundMethodOpeningBrace) {
                  methodEndLine = k + 1;
                  break;
                }
                
                if (k === lines.length - 1) {
                  methodEndLine = k + 1;
                }
              }
              
              // Just add basic method info as a function for now
              const methodInfo: FunctionInfo = {
                name: `Method_${j}`, // We'd extract proper name in actual impl
                startLine: methodStartLine,
                endLine: methodEndLine,
                parameters: [],  // Would extract from signature
                nestingDepth: 0,
                complexity: 1,
                linesOfCode: 1,
                sourceCode: ''
              };
              
              methods.push(methodInfo);
            }
          }
          
          const classInfo: ClassInfo = {
            name: structName,
            methods,
            fields: [], // We could extract struct fields in complete implementation
            superClass: undefined, // No inheritance in Go
            startLine,
            endLine,
            sourceCode: lines.slice(startLine - 1, endLine).join('\n')
          };
          
          classes.push(classInfo);
        }
      }
    }
  } catch (e) {
    console.error('Error extracting Go structs:', e);
  }
  
  return classes;
};

export const countLinesOfCode = (sourceCode: string): number => {
  if (!sourceCode) return 0;
  
  const lines = sourceCode.split('\n');
  let loc = 0;
  
  for (const line of lines) {
    if (isEmptyOrComment(line)) {
      continue;
    }
    loc++;
  }
  
  return loc;
};

export const isComment = (
  sourceCode: string,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): boolean => {
  const lines = sourceCode.split('\n');
  
  for (let i = startLine - 1; i < Math.min(endLine, lines.length); i++) {
    const line = lines[i];
    
    if (line.trim().startsWith('//') || isInMultiLineComment(lines, i)) {
      return true;
    }
  }
  
  return false;
};

export const getFunctionSignature = (funcInfo: FunctionInfo): string => {
  const params = funcInfo.parameters.map(p => p.name).join(', ');
  return `${funcInfo.name}(${params})`;
};

// Helper functions for Go parsing
const parseGoParameters = (paramsStr: string): ParameterInfo[] => {
  const params: ParameterInfo[] = [];
  
  // Simplified parsing for demo purposes
  if (!paramsStr || paramsStr === '()') return [];
  
  // Remove outer parentheses
  const content = paramsStr.substring(1, paramsStr.length - 1).trim();
  
  if (!content) return [];
  
  // In real implementation, we'd handle multiple parameters
  // Format might be: paramName type, paramName2 type2, or just typelist
  let currentParam = '';
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    if (escaped) {
      escaped = false;
      currentParam += char;
      continue;
    }
    
    if (char === '\\') {
      escaped = true;
      currentParam += char;
      continue;
    }
    
    if ((char === '"' || char === '`') && !inString) {
      inString = true;
    } else if (char === '"' && content[i-1] !== '\\' && inString) {
      inString = false;
    } else if (char === '`' && inString) {
      // For raw strings with backticks, closing only with backtick
      inString = false;
    }
    
    if (inString) {
      currentParam += char;
      continue;
    }
    
    if (char === '(' || char === '[') {
      bracketDepth++;
      currentParam += char;
    } else if (char === ')' || char === ']') {
      bracketDepth--;
      currentParam += char;
    } else if (char === ',' && bracketDepth === 0) {
      // End of parameter
      params.push({ name: currentParam.trim() });
      currentParam = '';
      continue;
    } else {
      currentParam += char;
    }
  }
  
  if (currentParam.trim()) {
    params.push({ name: currentParam.trim() });
  }
  
  return params.filter(p => p.name);
};

const isEmptyOrComment = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed === '' || 
         trimmed.startsWith('//') || 
         trimmed.startsWith('/*') ||
         trimmed === '*/';
};

const isInMultiLineComment = (lines: string[], currentIndex: number): boolean => {
  // Simple heuristic to check if current line is in a multiline comment
  // For a more accurate implementation, we'd track the entire file state
  let openComments = 0;
  
  for (let i = 0; i <= currentIndex; i++) {
    const line = lines[i];
    
    if (line.includes('/*')) openComments++;
    if (line.includes('*/')) openComments--;
  }
  
  return openComments > 0;
};

const calculateNestingDepth = (lines: string[], beginIndex: number, endIndex: number): number => {
  let maxDepth = 0;
  let currentDepth = 0;
  
  // Count nesting by looking at block scopes within a range of lines  
  for (let i = beginIndex; i < endIndex && i < lines.length; i++) {
    const line = lines[i];
    let inString = false;
    let escaped = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (escaped) {
        escaped = false;
        continue;
      }
      
      if (char === '\\') {
        escaped = true;
        continue;
      }
      
      if (char === '"' || char === '`') {
        inString = !inString;
        continue;
      }
      
      if (inString) {
        continue;
      }
      
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth--;
      }
    }
  }
  
  return maxDepth;
};

const calculateCyclomaticComplexityGo = (lines: string[], beginIndex: number, endIndex: number): number => {
  let complexity = 1; // Base complexity of 1
  
  // Go doesn't have for/while distinction unlike other languages, but we count conditionals
  for (let i = beginIndex; i < endIndex && i < lines.length; i++) {
    const lowerLine = lines[i].toLowerCase();
    
    // Keywords that increase cyclomatic complexity in Go
    if (hasControlFlow(lowerLine)) {
      complexity++;
    }
  }
  
  return complexity;
};

const hasControlFlow = (line: string): boolean => {
  return /\b(if|for|switch|case|default)\b/.test(line);
};