import { FunctionInfo, ClassInfo, FieldInfo, ParameterInfo, LanguageAdapter } from '../types.js';

/**
 * Language adapter for Java files.
 * 
 * Uses AST parsing to extract code constructs like classes,
 * methods, parameters, and complexity metrics.
 */

export const getFileExtensions = (): string[] => ['.java'];

export const parseAST = async (sourceCode: string): Promise<any> => {
  // For this initial implementation, we return a simple representation
  // In practice, we would integrate with Java AST parsers via a subprocess or bridge
  return { code: sourceCode, type: 'stub' };
};

export const extractFunctions = (ast: any): FunctionInfo[] => {
  // In Java, functions are called methods and are inside classes
  const functions: FunctionInfo[] = [];
  
  try {
    if (!ast || !ast.code) {
      return functions;
    }
    
    const lines = ast.code.split('\n');
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i].trim();
      
      // Java method declarations follow a pattern:
      // [access modifier] [static] [return type] methodName(parameters) [throws Exception]
      if (hasMethodSignature(line)) {
        const methodMatch = line.match(/^.*?\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/);
        
        if (methodMatch) {
          const name = methodMatch[1];
          const paramsStr = methodMatch[2] || '';
          const startLine = i + 1;
          
          // Find the end of the method by looking for matching braces
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
              
              if (char === '"' || char === '\'') {
                // Toggle string state as long as it's not an escaped quote or a character following certain patterns
                if (k === 0 || currentLine[k - 1] !== '\\') {
                  inString = !inString;
                }
                continue;
              }
              
              if (inString) continue;
              
              if (char === '{') {
                if (!foundOpeningBrace && currentLine.includes('{')) foundOpeningBrace = true;
                braceDepth++;
              } else if (char === '}') {
                braceDepth--;
                
                // If we've closed the initial opening brace, exit
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
          
          // Parse parameters
          const parameters = parseJavaParameters(paramsStr);
          
          // Calculate line of code count, excluding comments and empty lines
          let linesOfCode = 0;
          for (let idx = startLine; idx < endLine - 1; idx++) {
            const lineContent = lines[idx];
            if (isLineComment(lineContent) || lineContent.trim() === '') {
              continue;
            }
            linesOfCode++;
          }
          
          // Calculate nesting depth
          const nestingDepth = calculateNestingDepthJava(lines, i, endLine);
          
          // Calculate complexity
          const complexity = calculateCyclomaticComplexityJava(lines, i, endLine);
          
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
    console.error('Error extracting Java methods:', e);
  }
  
  return functions;
};

export const extractClasses = (ast: any): ClassInfo[] => {
  const classes: ClassInfo[] = [];
  
  try {
    if (!ast || !ast.code) {
      return classes;
    }
    
    const lines = ast.code.split('\n');
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i].trim();
      
      // Look for class declarations
      if (/^(public|private|protected)?\s*(abstract)?\s*(final)?\s*class\s+\w+/.test(line)) {
        // Better regex to match class declaration and extract class name
        const classMatch = line.match(/(class|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
        
        if (classMatch) {
          const className = classMatch[2];
          const typeKeyword = classMatch[1];  // 'class' or 'interface'
          const startLine = i + 1;
          
          // If class extends other classes or implements interfaces
          const superClassMatch = line.match(/extends\s+(\w+)/);
          const implementsMatch = line.match(/implements\s+([\w,\s]+)/);
          
          let superClass: string | undefined;
          if (superClassMatch) {
            superClass = superClassMatch[1];
          }
          
          // Find class end by matching braces
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
              
              if (char === '"' || char === '\'') {
                if (k === 0 || currentLine[k - 1] !== '\\') {
                  inString = !inString;
                }
                continue;
              }
              
              if (inString) continue;
              
              if (char === '{') {
                if (!foundOpeningBrace && currentLine.includes('{')) foundOpeningBrace = true;
                braceDepth++;
              } else if (char === '}') {
                braceDepth--;
                
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
          
          // Extract methods and fields within this class
          const methods: FunctionInfo[] = [];
          const fields: FieldInfo[] = [];
          
          for (let j = i + 1; j < endLine - 1; j++) {  // Don't include the closing brace
            const currentLine = lines[j].trim();
            
            if (hasFieldSignature(currentLine)) {
              // Extract field information (simplistic for this example)
              const fieldNameMatch = currentLine.match(/(?:private|public|protected)*\s*(?:static\s+)?\w+\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
              if (fieldNameMatch) {
                const fieldName = fieldNameMatch[1];
                const visibility = extractVisibility(currentLine);
                
                const field: FieldInfo = {
                  name: fieldName,
                  type: 'unknown', // We'd extract the type in a complete implementation
                  visibility,
                  startLine: j + 1,
                  endLine: j + 1  // Fields typically are on a single line
                };
                
                fields.push(field);
              }
            } else if (hasMethodSignature(currentLine)) {
              // We'll just get the method info by calling extractFunctions on the specific method
              // For this implementation, we'll record the basics and come back to it properly
              const methodMatch = currentLine.match(/^.*?\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
              if (methodMatch) {
                const methodName = methodMatch[1];
                
                // Temporarily create basic method info
                methods.push({
                  name: methodName,
                  startLine: j + 1,
                  endLine: j + 2,  // Placeholder
                  parameters: [],
                  nestingDepth: 0,
                  complexity: 1,
                  linesOfCode: 1,
                  sourceCode: currentLine
                });
              }
            }
          }
          
          const implementsList = implementsMatch ? implementsMatch[1].replace(/\s+/g, '').split(',') : undefined;
          
          const classInfo: ClassInfo = {
            name: className,
            methods,
            fields,
            superClass,
            implements: implementsList,
            startLine,
            endLine,
            sourceCode: lines.slice(startLine - 1, endLine).join('\n'),
            metadata: {
              type: typeKeyword  // 'class' or 'interface'
            }
          };
          
          classes.push(classInfo);
        }
      }
      
      i++;
    }
  } catch (e) {
    console.error('Error extracting Java classes:', e);
  }
  
  return classes;
};

export const countLinesOfCode = (sourceCode: string): number => {
  if (!sourceCode) return 0;
  
  const lines = sourceCode.split('\n');
  let loc = 0;
  
  for (const line of lines) {
    if (isLineComment(line) || line.trim() === '') {
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
    
    if (line.trim().startsWith('//') || isInJavaMultiLineComment(lines, i)) {
      return true;
    }
  }
  
  return false;
};

export const getFunctionSignature = (funcInfo: FunctionInfo): string => {
  const params = funcInfo.parameters.map(p => p.name).join(', ');
  return `${funcInfo.name}(${params})`;
};

// Helper functions for Java parsing
const hasMethodSignature = (line: string): boolean => {
  // This is approximate - a full Java parser would be needed for complete accuracy
  // Looks for patterns like: 'public void methodName(', 'String getValue(', 'int calculate(int a, int b)'
  return /(public|private|protected)*\s*(static\s+)?\s*\w+\s+\w+\s*\(|^\w+\s+\w+\s*\(/.test(line) &&
         !(line.includes('class ') || line.includes('interface ') || line.includes('enum '));
};

const hasFieldSignature = (line: string): boolean => {
  // Heuristic: looks for lines that might be fields
  // Patterns like: public String varName;, private int count;
  return /(public|private|protected)\s+(\w+)\s+(\w+)(\s*=\s*.*)?;\s*$/.test(line) &&
         !line.includes('(') && !line.includes(')') &&
         !line.startsWith('import') && !line.startsWith('package');
};

const parseJavaParameters = (paramsStr: string): ParameterInfo[] => {
  const params: ParameterInfo[] = [];
  
  if (!paramsStr.trim()) return params;
  
  let currentParam = '';
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;
  
  for (let i = 0; i < paramsStr.length; i++) {
    const char = paramsStr[i];
    
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
    
    if ((char === '"' || char === '\'') && !inString) {
      inString = true;
    } else if ((char === '"' || char === '\'') && inString && paramsStr[i-1] !== '\\') {
      inString = false;
    } else if (char === '`' && inString) {
      inString = false;
    }
    
    if (inString) {
      currentParam += char;
      continue;
    }
    
    if (char === '<' || char === '[') {
      bracketDepth++;
      currentParam += char;
    } else if (char === '>' || char === ']') {  
      bracketDepth--;
      currentParam += char;
    } else if (char === ',' && bracketDepth === 0) {
      // Process complete parameter
      const paramInfo = parseSingleParameter(currentParam.trim());
      params.push(paramInfo);
      currentParam = '';
      continue;
    } else {
      currentParam += char;
    }
  }
  
  if (currentParam.trim()) {
    const paramInfo = parseSingleParameter(currentParam.trim());
    params.push(paramInfo);
  }
  
  return params.filter(p => p.name || p.type);
};

const parseSingleParameter = (paramStr: string): ParameterInfo => {
  // Extract type and name from paramStr like 'String[] args', 'int x', 'MyType obj'
  const parts = paramStr.trim().split(' ');
  if (parts.length >= 2) {
    const type = parts.slice(0, parts.length-1).join(' ').trim();  // May include array brackets
    const name = parts[parts.length-1];  // Last part should be the name
    
    // Special handling for array notation
    let processedType = type;
    if (name.startsWith('[') && name.endsWith(']')) {
      processedType = type + name;  // Include array dimensions in type
    }
    
    return {
      name: name.replace(/^\[[^\]]*\]*\s*/, ''), // Remove array brackets from name part if any
      type: processedType
    };
  } else {
    // If we couldn't parse properly, assume paramStr is the name with unknown type
    return { name: paramStr, type: 'unknown' };
  }
};

const isLineComment = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.startsWith('//') ||
         trimmed.startsWith('/*') ||
         trimmed === '*/' ||
         trimmed.startsWith('*');
};

const isInJavaMultiLineComment = (lines: string[], currentIndex: number): boolean => {
  let inMultiLineComment = false;
  
  for (let i = 0; i <= currentIndex; i++) {
    const line = lines[i].trim();
    
    if (line.includes('/*') && !line.includes('*/')) {
      inMultiLineComment = true;
    } else if (inMultiLineComment) {
      if (line.includes('*/')) {
        inMultiLineComment = false;
      }
      // if line doesn't contain */, we're still in multi-line comment
    }
  }
  
  return inMultiLineComment;
};

const calculateNestingDepthJava = (lines: string[], beginIndex: number, endIndex: number): number => {
  let maxDepth = 0;
  let currentDepth = 0;
  
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
      
      if (char === '"' || char === '\'') {
        if (j === 0 || line[j - 1] !== '\\') {
          inString = !inString;
        }
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

const calculateCyclomaticComplexityJava = (lines: string[], beginIndex: number, endIndex: number): number => {
  let complexity = 1; // Base complexity
  
  for (let i = beginIndex; i < endIndex && i < lines.length; i++) {
    const lowerLine = lines[i].toLowerCase();
    
    // Keywords that affect complexity in Java
    if (hasControlFlowJava(lowerLine)) {
      complexity++;
    }
  }
  
  return complexity;
};

const hasControlFlowJava = (line: string): boolean => {
  // Java control flow keywords that impact complexity
  return /\b(if|for|while|do|case|default|catch|else if|&&|\|\|)\b/.test(line);
};

const extractVisibility = (line: string): 'public' | 'private' | 'protected' => {
  if (line.includes('public ')) {
    return 'public';
  } else if (line.includes('private ')) {
    return 'private';
  } else if (line.includes('protected ')) {
    return 'protected';
  }
  // Default assumption for package-private in Java would be different handling
  // If no visibility is specified, in Java it's package-private which doesn't get a specifier
  return 'public'; // As a default in our simplified model
};