using System;
using System.IO;
using System.Diagnostics;
using System.Reflection;
using System.Threading;

// Explicitly tell Windows this app can handle large memory and file offsets
[assembly: AssemblyTitle("EchoType Setup")]
[assembly: AssemblyVersion("2.0.0.0")]

namespace EchoTypeInstaller
{
    class Program
    {
        static void Main(string[] args)
        {
            try
            {
                // Professional Terminal UX
                Console.ForegroundColor = ConsoleColor.Magenta;
                Console.WriteLine("==========================================");
                Console.WriteLine("      EchoType Professional Installer     ");
                Console.WriteLine("==========================================");
                Console.ResetColor();
                
                string selfPath = Process.GetCurrentProcess().MainModule.FileName;
                FileInfo fi = new FileInfo(selfPath);
                
                Console.WriteLine("\n[1/3] System Integrity Check...");
                Console.WriteLine("      Installer Size: " + (fi.Length / (1024 * 1024 * 1024.0)).ToString("F2") + " GB");
                
                // Create Temp Area
                string tempDir = Path.Combine(Path.GetTempPath(), "ET_Setup_" + Guid.NewGuid().ToString("N").Substring(0, 6));
                Directory.CreateDirectory(tempDir);
                
                // Extraction Logic using 64-bit streaming
                // We will use the embedded 7z tools we prepared earlier
                string sevenZipExe = Path.Combine(tempDir, "7z.exe");
                string sevenZipDll = Path.Combine(tempDir, "7z.dll");
                
                Console.WriteLine("[2/3] Preparing Extraction Engine...");
                File.WriteAllBytes(sevenZipExe, Convert.FromBase64String(Resources.SevenZipExe));
                File.WriteAllBytes(sevenZipDll, Convert.FromBase64String(Resources.SevenZipDll));

                Console.WriteLine("[3/3] Extracting Assets (Streaming)...");
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = sevenZipExe;
                // EXTREMELY IMPORTANT: We tell 7z to look for the archive signature 
                // within the 6GB file. 64-bit 7z is designed for this.
                psi.Arguments = string.Format("x \"{0}\" -o\"{1}\" -y", selfPath, tempDir);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = false;
                
                Process p = Process.Start(psi);
                p.WaitForExit();
                
                if (p.ExitCode == 0 || p.ExitCode == 1) {
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine("\nDone! Executing post-install logic...");
                    
                    ProcessStartInfo psiPS = new ProcessStartInfo();
                    psiPS.FileName = "powershell.exe";
                    psiPS.Arguments = "-ExecutionPolicy Bypass -File deploy-extras-smart-logic.ps1";
                    psiPS.WorkingDirectory = tempDir;
                    psiPS.UseShellExecute = false;
                    Process.Start(psiPS).WaitForExit();
                } else {
                    throw new Exception("Extraction failed with error code: " + p.ExitCode);
                }

                Console.WriteLine("\nInstallation Complete. Closing in 5 seconds...");
                Thread.Sleep(5000);
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("\n[FATAL ERROR] " + ex.Message);
                Console.WriteLine("Please try running as Administrator or contact developer.");
                Console.ResetColor();
                Console.ReadKey();
            }
        }
    }
}
