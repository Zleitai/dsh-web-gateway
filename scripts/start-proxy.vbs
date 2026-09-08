' Start the project proxy without opening a console window.
Option Explicit
Dim shell, fileSystem, scriptDirectory, proxyPath
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
proxyPath = fileSystem.BuildPath(fileSystem.GetParentFolderName(scriptDirectory), "src\proxy.mjs")
shell.Run "node.exe """ & proxyPath & """", 0, False
