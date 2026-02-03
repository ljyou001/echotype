using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class IconReplacer
{
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateResource(IntPtr hUpdate, IntPtr lpType, IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool EndUpdateResource(IntPtr hUpdate, bool fDiscard);

    static readonly IntPtr RT_ICON = (IntPtr)3;
    static readonly IntPtr RT_GROUP_ICON = (IntPtr)14;

    public static void ReplaceIcon(string exePath, string iconPath)
    {
        byte[] iconData = File.ReadAllBytes(iconPath);
        
        // Parse ICO header
        // 0-1 reserved, 2-3 type (1 for ico), 4-5 count
        int count = BitConverter.ToUInt16(iconData, 4);
        
        IntPtr hUpdate = BeginUpdateResource(exePath, false);
        if (hUpdate == IntPtr.Zero) throw new Exception("BeginUpdateResource failed");

        // Group Icon Data
        // Header: 0-1 reserved, 2-3 type, 4-5 count
        byte[] groupIconData = new byte[6 + count * 14];
        Array.Copy(iconData, 0, groupIconData, 0, 6);

        for (int i = 0; i < count; i++)
        {
            int offset = 6 + i * 16;
            // Icon Entry: Width, Height, Colors, Reserved, Planes, BitCount, BytesInRes, ImageOffset
            byte width = iconData[offset];
            byte height = iconData[offset + 1];
            byte colors = iconData[offset + 2];
            byte reserved = iconData[offset + 3];
            short planes = BitConverter.ToInt16(iconData, offset + 4);
            short bitCount = BitConverter.ToInt16(iconData, offset + 6);
            uint bytesInRes = BitConverter.ToUInt32(iconData, offset + 8);
            uint imageOffset = BitConverter.ToUInt32(iconData, offset + 12);

            byte[] imageData = new byte[bytesInRes];
            Array.Copy(iconData, (int)imageOffset, imageData, 0, (int)bytesInRes);

            // Update RT_ICON
            // Resource ID starts from 1 for 7z.sfx as we saw in inspect
            if (!UpdateResource(hUpdate, RT_ICON, (IntPtr)(i + 1), 0, imageData, bytesInRes))
                throw new Exception("UpdateResource RT_ICON failed at " + i);

            // Update Group Icon Entry
            // Width, Height, Colors, Reserved, Planes, BitCount, BytesInRes, ID
            int groupOffset = 6 + i * 14;
            groupIconData[groupOffset] = width;
            groupIconData[groupOffset + 1] = height;
            groupIconData[groupOffset + 2] = colors;
            groupIconData[groupOffset + 3] = reserved;
            Array.Copy(iconData, offset + 4, groupIconData, groupOffset + 4, 4); // Planes + BitCount
            Array.Copy(iconData, offset + 8, groupIconData, groupOffset + 8, 4); // BytesInRes
            byte[] idBytes = BitConverter.GetBytes((short)(i + 1));
            Array.Copy(idBytes, 0, groupIconData, groupOffset + 12, 2);
        }

        if (!UpdateResource(hUpdate, RT_GROUP_ICON, (IntPtr)1, 0, groupIconData, (uint)groupIconData.Length))
            throw new Exception("UpdateResource RT_GROUP_ICON failed");

        if (!EndUpdateResource(hUpdate, false)) throw new Exception("EndUpdateResource failed");
        
        Console.WriteLine("Icon replaced successfully!");
    }
}
