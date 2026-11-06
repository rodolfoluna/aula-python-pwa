// Aula Python: standalone Windows console launcher. The browser appends a JSON
// project and a 12-byte footer to this template; no student code reaches a server.
using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

class AulaPython {
    [DllImport("kernel32.dll")] static extern uint GetConsoleProcessList(uint[] list, uint count);
    static string Quote(string value) {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            result.Append('\\', character == '"' ? slashes * 2 + 1 : slashes); result.Append(character); slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
    }
    static int Main(string[] args) {
        bool pause = false; string folder = null;
        string root = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "AulaPython"));
        try {
            uint[] processes = new uint[8]; pause = GetConsoleProcessList(processes, 8) == 1 && !Console.IsInputRedirected;
            Console.OutputEncoding = new UTF8Encoding(false); Console.InputEncoding = new UTF8Encoding(false);
            string exe = Assembly.GetExecutingAssembly().Location;
            byte[] payload;
            using (var file = File.OpenRead(exe)) {
                if (file.Length < 12) throw new Exception("Ejecutable incompleto.");
                file.Seek(-12, SeekOrigin.End); byte[] footer = new byte[12]; file.Read(footer, 0, 12);
                int size = BitConverter.ToInt32(footer, 8);
                if (Encoding.ASCII.GetString(footer, 0, 8) != "AULAPY01" || size < 2 || size > 1048576 || size > file.Length - 12) throw new Exception("Este ejecutable no contiene un proyecto válido.");
                file.Seek(-12 - size, SeekOrigin.End); payload = new byte[size]; int offset = 0;
                while (offset < size) { int read = file.Read(payload, offset, size - offset); if (read == 0) throw new Exception("Proyecto incompleto."); offset += read; }
            }
            var serializer = new JavaScriptSerializer { MaxJsonLength = 1048576 };
            var project = serializer.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(payload));
            var files = project["files"] as Dictionary<string, object>; string entry = project["entry"] as string;
            if (files == null || files.Count == 0 || files.Count > 600 || entry == null || !files.ContainsKey(entry)) throw new Exception("No se encontró el archivo que se debe ejecutar.");
            foreach (var item in files) if (!Regex.IsMatch(item.Key, "^[A-Za-z_][A-Za-z0-9_]*\\.py$") || !(item.Value is string)) throw new Exception("Archivo no válido en el proyecto.");
            folder = Path.GetFullPath(Path.Combine(root, Guid.NewGuid().ToString("N")));
            if (!folder.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("Carpeta temporal no válida.");
            Directory.CreateDirectory(folder);
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("AulaPython.Runtime"))
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Read)) {
                foreach (var item in zip.Entries) {
                    string path = Path.GetFullPath(Path.Combine(folder, item.FullName));
                    if (!path.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("Ruta de Python no válida.");
                    if (item.Name.Length == 0) { Directory.CreateDirectory(path); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    using (var input = item.Open()) using (var output = File.Create(path)) input.CopyTo(output);
                }
            }
            foreach (var item in files) File.WriteAllText(Path.Combine(folder, item.Key), (string)item.Value, new UTF8Encoding(false));
            string arguments = "-X utf8 -u -B " + Quote(Path.Combine(folder, entry));
            foreach (string argument in args) arguments += " " + Quote(argument);
            var start = new ProcessStartInfo(Path.Combine(folder, "python.exe"), arguments) { UseShellExecute = false, WorkingDirectory = Environment.CurrentDirectory };
            int code; using (var process = Process.Start(start)) { process.WaitForExit(); code = process.ExitCode; }
            if (pause) { Console.WriteLine("\nPresiona Enter para cerrar."); Console.ReadLine(); }
            return code;
        } catch (Exception error) {
            Console.Error.WriteLine("Aula Python: " + error.Message);
            if (pause) { Console.WriteLine("Presiona Enter para cerrar."); Console.ReadLine(); }
            return 1;
        } finally {
            if (folder != null && Path.GetFullPath(folder).StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) {
                try { Directory.Delete(folder, true); } catch { }
            }
        }
    }
}
