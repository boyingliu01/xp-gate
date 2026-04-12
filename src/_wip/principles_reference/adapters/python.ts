import { FunctionInfo, ClassInfo, FieldInfo, ParameterInfo, LanguageAdapter } from '../types.js';

/**
 * Language adapter for Python files.
 * 
 * Uses AST parsing to extract code constructs like functions, classes,
 * methods, parameters, and complexity metrics.
 */

export const getFileExtensions = (): string[] => ['.py'];

export const parseAST = async (sourceCode: string): Promise<any> => {
  // For this initial implementation, we return a simple representation
  // In practice, we could integrate with python AST parsing tools like python ast module 
  // or communicate with a Python subprocess using exec
  return { code: sourceCode, type: 'stub' };
};

export const extractFunctions = (ast: any): FunctionInfo[] => {
  const functions: FunctionInfo[] = [];
  
  // A real implementation would parse the Python AST
  // This is a stub implementation showing the structure
  
  try {
    // For demonstration, we parse def statements as a simple string matching approach
    // For real implementation you'd want to use proper AST parsing
    const lines = ast.code.split('\n');
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i].trim();
      
      // Find function definitions
      if (line.startsWith('def ')) {
        const defMatch = line.match(/^def (\w+)\s*\(([^)]*)\)\s*:/);
        
        if (defMatch) {
          const name = defMatch[1];
          const paramsStr = defMatch[2];
          const startLine = i + 1;
          
          // Find function end by looking for reduced indentation
          let endLine = startLine;
          const funcIndent = getIndentLevel(lines[i]);
        
          for (let j = i + 1; j < lines.length; j++) {
            const currentLine = lines[j];
            
            // Skip empty lines and comments
            if (currentLine.trim() === '' || currentLine.trim().startsWith('#')) {
              if (currentLine.trim() !== '') {
                endLine = j + 1;
              }
              continue;
            }
            
            const currentIndent = getIndentLevel(currentLine);
            
            // If indentation is less than function's indentation, we've exited the function
            if (currentIndent <= funcIndent && currentIndent < 100) { // 100 is used to ignore comment-only lines in this heuristic
              break;
            }
            endLine = j + 1;
          }
          
          // Parse parameters
          const parameters: ParameterInfo[] = paramsStr.split(',')
            .filter(p => p.trim())
            .map(paramStr => {
              const paramTrimmed = paramStr.trim();
              const colonIndex = paramTrimmed.indexOf(':');
              
              if (colonIndex > 0) {
                return {
                  name: paramTrimmed.substr(0, colonIndex).trim(),
                  type: paramTrimmed.substr(colonIndex + 1).trim()
                };
              } else if (paramTrimmed.endsWith('=')) {
                const equalIndex = paramTrimmed.lastIndexOf('=');
                return {
                  name: paramTrimmed.substr(0, equalIndex).trim(),
                  optional: true
                };
              } else {
                return { name: paramTrimmed };
              }
            });
          
          // Calculate lines of code in function body (excluding function declaration line)
          let linesOfCode = 0;
          const bodyStartIndex = i; // Index of function definition
      
          for (let idx = bodyStartIndex + 1; idx < endLine; idx++) {
            const trimmed = lines[idx].trim();
            if (trimmed !== '' && !trimmed.startsWith('#')) {
              linesOfCode++;
            }
          }
          
          // Calculate nesting depth (simplified)
          const nestingDepth = Math.floor(funcIndent / 2); // Assuming 2-space indentation per level
          
          // Calculate complexity (simplified)
          const complexity = calculateCyclomaticComplexityForPython(lines, i, endLine);
          
          const funcInfo: FunctionInfo = {
            name,
            startLine,
            endLine,
            parameters,
            nestingDepth,
            complexity,
            linesOfCode,
            sourceCode: lines.slice(startLine - 1, endLine).join('\n')
          };
          
          functions.push(funcInfo);
        }
      }
      
      i++;
    }
  } catch (e) {
    console.error('Error extracting functions:', e);
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
      
      // Find class definitions
      if (line.startsWith('class ')) {
        const classMatch = line.match(/^class (\w+)($|\(|:)/);
        
        if (classMatch) {
          const className = classMatch[1];
          const startLine = i + 1;
          
          // Determine superclass if exists
          let superClass: string | undefined;
          const inheritMatch = line.match(/^class \w+\(([\w.]+)\)/);
          if (inheritMatch) {
            superClass = inheritMatch[1];
          }
          
          // Find class end by looking for reduced indentation
          let endLine = startLine;
          const classIndent = getIndentLevel(lines[i]);
          
          for (let j = i + 1; j < lines.length; j++) {
            const currentLine = lines[j];
            
            // Skip empty lines and comments
            if (currentLine.trim() === '' || currentLine.trim().startsWith('#')) {
              if (currentLine.trim() !== '') {
                endLine = j + 1;
              }
              continue;
            }
            
            const currentIndent = getIndentLevel(currentLine);
            
            // If indentation is less than class's indentation, we've exited the class
            if (currentIndent < classIndent) {
              break;
            }
            endLine = j + 1;
          }
          
          // Extract methods in the class
          const methods: FunctionInfo[] = [];
          let methodIndex = i + 1; // Skip the class declaration line
          
          while (methodIndex < endLine) {
            const methodLine = lines[methodIndex].trim();
            
            // Find methods defined inside the class (indented functions)
            if (methodLine.startsWith('def ') && getIndentLevel(lines[methodIndex]) > classIndent) {
              const methodMatch = methodLine.match(/^def (\w+)\s*\(([^)]*)\)\s*:/);
              
              if (methodMatch) {
                const methodName = methodMatch[1];
                const paramsStr = methodMatch[2];
                
                // Basic approach to find this method's end
                const methodStartLine = methodIndex;
                const methodIndentLevel = getIndentLevel(lines[methodIndex]);
                
                let methodEndLine = methodStartLine + 1;
                
                for (let mIdx = methodIndex + 1; mIdx < endLine; mIdx++) {
                  const mL = lines[mIdx];
                  
                  if (getIndentLevel(mL) <= methodIndentLevel && mL.trim() !== '') {
                    break;
                  }
                  methodEndLine = mIdx + 1;
                }
                
                // For simplicity, create a dummy function with basic attributes
                const methodInfo: FunctionInfo = {
                  name: methodName,
                  startLine: methodStartLine + 1,
                  endLine: methodEndLine,
                  parameters: [],
                  nestingDepth: 0,
                  complexity: 1,
                  linesOfCode: 1,
                  sourceCode: ''
                };
                
                methods.push(methodInfo);
              }
            }
            
            methodIndex++;
          }
          
          const classInfo: ClassInfo = {
            name: className,
            methods,
            fields: [], // In Python, fields are typically initialized in __init__ as assignments
            startLine,
            endLine, 
            sourceCode: lines.slice(startLine - 1, endLine).join('\n'),
            superClass
          };
          
          classes.push(classInfo);
        }
      }
      
      i++;
    }
  } catch (e) {
    console.error('Error extracting classes:', e);
  }
  
  return classes;
};

export const countLinesOfCode = (sourceCode: string): number => {
  if (!sourceCode) return 0;
  
  const lines = sourceCode.split('\n');
  let loc = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      loc++;
    }
  }
  
  return loc;
};

// In Python, we don't have block comments, just # for single line comments
export const isComment = (
  sourceCode: string,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): boolean => {
  const lines = sourceCode.split('\n');
  
  // For simplicity, check if the lines contain comments
  for (let i = startLine - 1; i < Math.min(endLine, lines.length); i++) {
    if (lines[i].trim().startsWith('#')) {
      return true;
    }
  }
  
  return false;
};

export const getFunctionSignature = (funcInfo: FunctionInfo): string => {
  const params = funcInfo.parameters.map(p => p.name).join(', ');
  return `${funcInfo.name}(${params})`;
};

// Helper functions for Python parsing
const getIndentLevel = (line: string): number => {
  let indent = 0;
  for (const char of line) {
    if (char === ' ') {
      indent++;
    } else if (char === '\t') {
      indent += 4; // Assuming tab is equivalent to 4 spaces
    } else {
      break;
    }
  }
  return indent;
};

const calculateCyclomaticComplexityForPython = (
  lines: string[],
  startLineIndex: number,
  endLineIndex: number
): number => {
  let complexity = 1; // Base complexity of 1 for the function itself

  for (let i = startLineIndex + 1; i < endLineIndex && i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    
    if (containsControlFlow(line)) {
      complexity++;
    }
  }
  
  return complexity;
};

const containsControlFlow = (line: string): boolean => {
  return [
    'if ', 'elif ', 'else:', 
    'for ', 'while ', 
    'except:', 'try:', 'finally:',
    'and ', ' or '
  ].some(keyword => 
    new RegExp('\\b' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(line)
  );
};