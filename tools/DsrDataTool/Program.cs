using System.Security.Cryptography;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using SoulsFormats;

const int SchemaVersion = 14;
Console.OutputEncoding = new UTF8Encoding(false);
Console.InputEncoding = new UTF8Encoding(false);

try
{
    if (args.Length == 0 || args[0] is "--help" or "-h")
    {
        PrintUsage();
        return 0;
    }

    var command = args[0].ToLowerInvariant();
    var options = ParseOptions(args.Skip(1).ToArray());
    var jsonOptions = new JsonSerializerOptions
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    if (command == "scan")
    {
        var gameDirectory = RequireDirectory(options, "game");
        var outputPath = RequireValue(options, "output");
        var catalog = ScanGame(gameDirectory);
        var fullOutputPath = Path.GetFullPath(outputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullOutputPath)!);
        File.WriteAllText(
            fullOutputPath,
            JsonSerializer.Serialize(catalog, jsonOptions) + Environment.NewLine);

        Console.WriteLine($"Maps: {catalog.Maps.Count}");
        Console.WriteLine($"Enemy slots: {catalog.EnemySlots.Count}");
        Console.WriteLine($"Boss slots: {catalog.BossSlots.Count}");
        Console.WriteLine($"World item lots: {catalog.WorldItemLots.Count}");
        Console.WriteLine($"Archetypes: {catalog.EnemyArchetypes.Count}");
        Console.WriteLine($"Read errors: {catalog.Errors.Count}");
        Console.WriteLine($"Output: {fullOutputPath}");
    }
    else if (command == "patch-enemies")
    {
        var report = PatchEnemies(
            RequireDirectory(options, "game"),
            Path.GetFullPath(RequireValue(options, "catalog")),
            Path.GetFullPath(RequireValue(options, "placements")),
            Path.GetFullPath(RequireValue(options, "output")),
            jsonOptions);
        Console.WriteLine($"Changed maps: {report.PatchedMaps.Count}");
        Console.WriteLine($"Changed AI bundles: {report.LuaBundles.Count}");
        Console.WriteLine($"Changed effect bundles: {(report.FfxBundle == null ? 0 : 1)}");
        Console.WriteLine($"Changed slots: {report.ChangedSlots}");
        Console.WriteLine($"Output: {report.OutputDirectory}");
    }
    else if (command == "install")
    {
        var report = InstallPackage(
            RequireDirectory(options, "game"),
            RequireDirectory(options, "package"),
            jsonOptions);
        Console.WriteLine($"Installed files: {report.Files.Count}");
        Console.WriteLine("State: ACTIVE");
    }
    else if (command == "restore")
    {
        var report = RestorePackage(
            RequireDirectory(options, "game"),
            RequireDirectory(options, "package"),
            jsonOptions);
        Console.WriteLine($"Restored files: {report.Files.Count}");
        Console.WriteLine("State: INACTIVE");
    }
    else if (command == "inspect-boss-bars")
    {
        InspectBossBars(RequireDirectory(options, "game"));
    }
    else
    {
        throw new ArgumentException($"Unknown command: {command}");
    }
    return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine(error.Message);
    return 1;
}

static void PrintUsage()
{
    Console.WriteLine("DsrDataTool");
    Console.WriteLine();
    Console.WriteLine("  scan --game <DSR directory> --output <catalog.json>");
    Console.WriteLine(
        "  patch-enemies --game <DSR directory> --catalog <catalog.json> " +
        "--placements <randomizer.json> --output <directory>");
    Console.WriteLine("  install --game <DSR directory> --package <seed directory>");
    Console.WriteLine("  restore --game <DSR directory> --package <seed directory>");
    Console.WriteLine("  inspect-boss-bars --game <DSR directory>");
}

static void InspectBossBars(string gameDirectory)
{
    var eventDirectory = Path.Combine(gameDirectory, "event");
    foreach (var eventPath in Directory.EnumerateFiles(eventDirectory, "*.emevd.dcx")
                 .OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
    {
        var emevd = EMEVD.Read(eventPath);
        foreach (var entry in emevd.Events)
        {
            foreach (var instruction in entry.Instructions.Where(value =>
                         value.Bank == 2003 && value.ID == 11))
            {
                Console.WriteLine(
                    $"{Path.GetFileName(eventPath)} event={entry.ID} " +
                    $"bytes={instruction.ArgData.Length} hex={Convert.ToHexString(instruction.ArgData)}");
            }
        }
    }
}

static Dictionary<string, string> ParseOptions(string[] values)
{
    var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    for (var index = 0; index < values.Length; index++)
    {
        var current = values[index];
        if (!current.StartsWith("--", StringComparison.Ordinal))
            throw new ArgumentException($"Invalid argument: {current}");
        if (index + 1 >= values.Length || values[index + 1].StartsWith("--", StringComparison.Ordinal))
            throw new ArgumentException($"Missing value for {current}.");
        result[current[2..]] = values[++index];
    }
    return result;
}

static string RequireValue(Dictionary<string, string> options, string name)
{
    if (!options.TryGetValue(name, out var value) || string.IsNullOrWhiteSpace(value))
        throw new ArgumentException($"Provide --{name}.");
    return value;
}

static string RequireDirectory(Dictionary<string, string> options, string name)
{
    var value = Path.GetFullPath(RequireValue(options, name));
    if (!Directory.Exists(value))
        throw new DirectoryNotFoundException($"Directory not found: {value}");
    return value;
}

static GameCatalog ScanGame(string gameDirectory)
{
    var executablePath = Path.Combine(gameDirectory, "DarkSoulsRemastered.exe");
    var mapDirectory = Path.Combine(gameDirectory, "map", "MapStudio");
    var gameParamPath = Path.Combine(
        gameDirectory, "param", "GameParam", "GameParam.parambnd.dcx");
    var paramdefPath = Path.Combine(
        gameDirectory, "paramdef", "paramdef.paramdefbnd.dcx");
    var itemMessagePath = Path.Combine(
        gameDirectory, "msg", "ENGLISH", "item.msgbnd.dcx");
    if (!File.Exists(executablePath))
        throw new FileNotFoundException("DarkSoulsRemastered.exe not found.", executablePath);
    if (!Directory.Exists(mapDirectory))
        throw new DirectoryNotFoundException($"MapStudio not found: {mapDirectory}");
    if (!File.Exists(itemMessagePath))
        throw new FileNotFoundException("English item messages not found.", itemMessagePath);

    var errors = new List<ScanError>();
    var enemyMetadata = new EnemyMetadataLookup(new(), new());
    if (File.Exists(gameParamPath) && File.Exists(paramdefPath))
    {
        try
        {
            enemyMetadata = ReadEnemyMetadata(gameParamPath, paramdefPath);
        }
        catch (Exception error)
        {
            errors.Add(new ScanError(
                "param/GameParam/GameParam.parambnd.dcx",
                "enemy-metadata-read",
                error.Message));
        }
    }

    var sourceFiles = new List<SourceFile>
    {
        DescribeSource(executablePath, gameDirectory),
    };
    if (File.Exists(gameParamPath))
        sourceFiles.Add(DescribeSource(gameParamPath, gameDirectory));
    if (File.Exists(paramdefPath))
        sourceFiles.Add(DescribeSource(paramdefPath, gameDirectory));
    sourceFiles.Add(DescribeSource(itemMessagePath, gameDirectory));

    var maps = new List<MapRecord>();
    var slots = new List<EnemySlotRecord>();
    var ignoredFiles = new List<string>();
    var mapNames = CreateMapNames();
    foreach (var mapPath in Directory.EnumerateFiles(mapDirectory, "*.msb")
                 .OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
    {
        var mapId = Path.GetFileNameWithoutExtension(mapPath);
        if (!IsGameplayMap(mapId))
        {
            ignoredFiles.Add(
                Path.GetRelativePath(gameDirectory, mapPath).Replace('\\', '/'));
            continue;
        }
        sourceFiles.Add(DescribeSource(mapPath, gameDirectory));
        var eventPath = Path.Combine(
            gameDirectory, "event", $"{mapId}.emevd.dcx");
        if (File.Exists(eventPath))
            sourceFiles.Add(DescribeSource(eventPath, gameDirectory));
        try
        {
            var map = MSB1.Read(mapPath);
            var eventModelLockedEntities = File.Exists(eventPath)
                ? ReadEventModelLockedEntities(eventPath)
                : new HashSet<int>();
            maps.Add(new MapRecord(
                mapId,
                mapNames.GetValueOrDefault(mapId, mapId),
                map.Parts.Enemies.Count,
                map.Parts.DummyEnemies.Count));

            slots.AddRange(map.Parts.Enemies.Select(
                enemy => ToSlot(
                    mapId, enemy, false, enemyMetadata,
                    eventModelLockedEntities)));
            slots.AddRange(map.Parts.DummyEnemies.Select(
                enemy => ToSlot(
                    mapId, enemy, true, enemyMetadata,
                    eventModelLockedEntities)));
        }
        catch (Exception error)
        {
            errors.Add(new ScanError(
                Path.GetRelativePath(gameDirectory, mapPath).Replace('\\', '/'),
                "msb-read",
                error.Message));
        }
    }

    var aiBundlePaths = maps
        .Select(map => NormalizeAiMapId(map.Id))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Select(mapId => Path.Combine(
            gameDirectory, "script", $"{mapId}.luabnd.dcx"))
        .Append(Path.Combine(
            gameDirectory, "script", "aiCommon.luabnd.dcx"))
        .ToList();
    foreach (var aiBundlePath in aiBundlePaths)
    {
        if (!File.Exists(aiBundlePath))
            throw new FileNotFoundException(
                "Required AI bundle not found.", aiBundlePath);
        sourceFiles.Add(DescribeSource(aiBundlePath, gameDirectory));
    }
    var aiGoalIds = aiBundlePaths
        .SelectMany(ReadLuaGoals)
        .Select(goal => goal.ID)
        .Distinct()
        .Order()
        .ToList();

    var archetypes = slots
        .Where(slot => slot.NpcParamId >= 0 && slot.ThinkParamId >= 0)
        .GroupBy(slot => new
        {
            slot.ModelName,
            slot.NpcParamId,
            slot.ThinkParamId,
            slot.CharaInitId,
            slot.TeamType,
            slot.NpcType,
            slot.MoveType,
            slot.HitHeight,
            slot.HitRadius,
            slot.BaseHp,
            slot.SoulReward,
            slot.BattleStartDistance,
            slot.EyeDistance,
            slot.EarDistance,
            slot.DisablePathMove,
            slot.BattleGoalId,
        })
        .Select(group => new EnemyArchetypeRecord(
            $"{group.Key.ModelName}:{group.Key.NpcParamId}:{group.Key.ThinkParamId}:{group.Key.CharaInitId}",
            group.Key.ModelName,
            group.Key.NpcParamId,
            group.Key.ThinkParamId,
            group.Key.CharaInitId,
            group.Key.TeamType,
            group.Key.NpcType,
            group.Key.MoveType,
            group.Key.HitHeight,
            group.Key.HitRadius,
            group.Key.BaseHp,
            group.Key.SoulReward,
            group.Key.BattleStartDistance,
            group.Key.EyeDistance,
            group.Key.EarDistance,
            group.Key.DisablePathMove,
            group.Key.BattleGoalId,
            group.Count(),
            group.Select(slot => slot.MapId).Distinct().Order().ToArray(),
            group.Count(slot => slot.SafeCandidate)))
        .OrderBy(archetype => archetype.ModelName)
        .ThenBy(archetype => archetype.NpcParamId)
        .ToList();

    var binderFiles = new List<BinderEntryRecord>();
    var startingClasses = new List<StartingClassRecord>();
    var startingItemLots = new List<StartingItemLotRecord>();
    var gifts = new List<ParamRowRecord>();
    var enemyDropLots = new List<ParamRowRecord>();
    var worldItemLots = new List<WorldItemLotRecord>();
    var shopEntries = new List<ShopEntryRecord>();
    var startingEquipmentPools = new StartingEquipmentPools(
        new(), new(), new(), new(), new());
    var itemNames = ReadEnglishItemNames(itemMessagePath);
    var bossNames = ReadEnglishBossNames(itemMessagePath, slots);
    if (File.Exists(gameParamPath))
    {
        try
        {
            var binder = BND3.Read(gameParamPath);
            binderFiles.AddRange(binder.Files.Select(file => new BinderEntryRecord(
                file.ID,
                file.Name.Replace('\\', '/'),
                file.Bytes.Length,
                Convert.ToHexString(SHA256.HashData(file.Bytes)).ToLowerInvariant())));
            if (File.Exists(paramdefPath))
            {
                var startingData = ReadStartingData(binder, paramdefPath);
                startingClasses = startingData.Classes;
                startingItemLots = startingData.ItemLots;
                var randomizerData = ReadRandomizerParamData(
                    binder,
                    paramdefPath,
                    itemNames,
                    slots.Where(slot => slot.SafeCandidate)
                        .Select(slot => slot.NpcParamId)
                        .ToHashSet());
                gifts = randomizerData.Gifts;
                enemyDropLots = randomizerData.EnemyDropLots;
                worldItemLots = randomizerData.WorldItemLots;
                shopEntries = randomizerData.ShopEntries;
                startingEquipmentPools = randomizerData.StartingEquipmentPools;
            }
        }
        catch (Exception error)
        {
            errors.Add(new ScanError(
                Path.GetRelativePath(gameDirectory, gameParamPath).Replace('\\', '/'),
                "gameparam-read",
                error.Message));
        }
    }

    return new GameCatalog(
        SchemaVersion,
        DateTimeOffset.UtcNow,
        "Dark Souls Remastered",
        "read-only-scan",
        sourceFiles,
        maps,
        slots,
        archetypes,
        slots.Where(slot => IsBossModel(slot.ModelName))
            .Where(slot => !slot.Dummy && IsPrimaryBossSlot(slot))
            .OrderBy(slot => slot.MapId).ThenBy(slot => slot.Name).ToList(),
        binderFiles,
        startingClasses,
        startingItemLots,
        gifts,
        enemyDropLots,
        worldItemLots,
        shopEntries,
        startingEquipmentPools,
        bossNames,
        aiGoalIds,
        errors,
        ignoredFiles);
}

static RandomizerParamData ReadRandomizerParamData(
    BND3 gameParam,
    string paramdefPath,
    ItemNameLookup itemNames,
    HashSet<int> safeNpcParamIds)
{
    var paramdefs = BND3.Read(paramdefPath).Files
        .Select(file => PARAMDEF.Read(file.Bytes))
        .ToList();
    PARAM ReadParam(string suffix)
    {
        var file = gameParam.Files.Single(entry =>
            entry.Name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));
        var param = PARAM.Read(file.Bytes);
        ApplyCompatibleParamdef(param, paramdefs);
        return param;
    }

    var itemLotParam = ReadParam("ItemLotParam.param");
    string DescribeItemLot(PARAM.Row row)
    {
        var names = Enumerable.Range(1, 8)
            .Select(slot =>
            {
                var suffix = slot.ToString("00");
                var itemId = GetCellInt(row, $"lotItemId{suffix}");
                if (itemId <= 0)
                    return null;
                var category = GetCellInt(row, $"lotItemCategory{suffix}");
                var quantity = GetCellInt(row, $"lotItemNum{suffix}", 1);
                var name = itemNames.GetName(category, itemId);
                return quantity > 1 ? $"{name} x{quantity}" : name;
            })
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToList();
        return names.Count > 0
            ? string.Join(" + ", names)
            : $"Item lot {row.ID}";
    }
    var giftIds = new HashSet<int>
    {
        1010, 1040, 1050, 1060, 1090, 1100, 1110, 1140, 1150, 1190,
        1200, 1210, 1240, 1250, 1280, 1290, 1300, 1500, 1510, 1520,
    };
    var gifts = itemLotParam.Rows
        .Where(row => giftIds.Contains(row.ID))
        .Where(row => row.Cells.Any(cell =>
            cell.Def.InternalName.StartsWith("lotItemId", StringComparison.Ordinal) &&
            Convert.ToInt32(cell.Value) > 0))
        .Select(row => new ParamRowRecord(
            row.ID,
            DescribeItemLot(row)))
        .OrderBy(row => row.RowId)
        .ToList();

    var npcParam = ReadParam("NpcParam.param");
    var dropLotIds = npcParam.Rows
        .Where(row => safeNpcParamIds.Contains(row.ID))
        .SelectMany(row => row.Cells
            .Where(cell => cell.Def.InternalName.StartsWith(
                "itemLotId_", StringComparison.OrdinalIgnoreCase))
            .Select(cell => Convert.ToInt32(cell.Value)))
        .Where(id => id > 0)
        .ToHashSet();
    var enemyDropLots = itemLotParam.Rows
        .Where(row => dropLotIds.Contains(row.ID))
        .Where(row => GetCellInt(row, "getItemFlagId", -1) <= 0)
        .Where(row => row.Cells.Any(cell =>
            cell.Def.InternalName.StartsWith("lotItemId", StringComparison.Ordinal) &&
            Convert.ToInt32(cell.Value) > 0))
        .Select(row => new ParamRowRecord(
            row.ID,
            DescribeItemLot(row)))
        .OrderBy(row => row.RowId)
        .ToList();

    var startingLotIds = StartingLotDefinitions().Values
        .SelectMany(roles => roles.Values)
        .Where(id => id.HasValue)
        .Select(id => id!.Value)
        .ToHashSet();
    var worldItemLots = itemLotParam.Rows
        .Where(row => row.ID is >= 1_000_000 and < 1_900_000)
        .Where(row => !startingLotIds.Contains(row.ID))
        .Where(row => row.Cells.Any(cell =>
            cell.Def.InternalName.StartsWith("lotItemId", StringComparison.Ordinal) &&
            Convert.ToInt32(cell.Value) > 0))
        .Select(row =>
        {
            var entries = Enumerable.Range(1, 8)
                .Select(slot =>
                {
                    var suffix = slot.ToString("00");
                    return new ItemLotEntryRecord(
                        GetCellInt(row, $"lotItemId{suffix}"),
                        GetCellInt(row, $"lotItemCategory{suffix}"),
                        GetCellInt(row, $"lotItemNum{suffix}", 1));
                })
                .Where(entry => entry.ItemId > 0)
                .ToList();
            const int accessoryCategory = 0x20000000;
            const int goodsCategory = 0x40000000;
            var protectedProgression = entries.Any(entry =>
                (entry.Category == goodsCategory &&
                    (entry.ItemId is >= 800 and < 900 ||
                     entry.ItemId is >= 2000 and < 3000 ||
                     entry.ItemId == 384)) ||
                (entry.Category == accessoryCategory &&
                    entry.ItemId is 138 or 139 or 149));
            var area = row.ID / 100_000 % 100;
            var block = row.ID / 10_000 % 10;
            var displayName = string.Join(" + ", entries.Select(entry =>
            {
                var name = itemNames.GetName(entry.Category, entry.ItemId);
                return entry.Quantity > 1 ? $"{name} x{entry.Quantity}" : name;
            }));
            return new WorldItemLotRecord(
                row.ID,
                string.IsNullOrWhiteSpace(displayName)
                    ? $"Unknown item lot {row.ID}"
                    : displayName,
                $"m{area:00}_{block:00}_00_00",
                protectedProgression,
                entries);
        })
        .OrderBy(row => row.RowId)
        .ToList();

    var shopParam = ReadParam("ShopLineupParam.param");
    var shopEntries = shopParam.Rows
        .Select(row =>
        {
            var equipId = GetCellInt(row, "equipId");
            var equipType = GetCellInt(row, "equipType");
            return new ShopEntryRecord(
                row.ID,
                itemNames.GetShopName(equipType, equipId),
                equipId,
                equipType,
                GetCellInt(row, "eventFlag", -1));
        })
        .Where(row => row.EquipId >= 0 && row.EquipType is >= 0 and <= 4)
        .OrderBy(row => row.RowId)
        .ToList();

    var weaponParam = ReadParam("EquipParamWeapon.param");
    var weapons = weaponParam.Rows
        // Use every named base weapon rather than only equipment that happens
        // to appear in a shop, loot table, or vanilla class. Explicitly named
        // reinforcement levels (such as Pyromancy Flame +1) are not valid
        // starting items.
        .Where(row => row.ID is >= 0 and < 2_000_000)
        // DSR reserves the final three digits for reinforcement/infusion
        // variants. Starting lots must use the base item ID; giving a class a
        // reinforced shield or weapon can corrupt the Asylum pickup flow.
        .Where(row => row.ID % 1_000 == 0)
        .Where(row => itemNames.Weapons.ContainsKey(row.ID))
        .Where(row => !Regex.IsMatch(itemNames.Weapons[row.ID], @"\+\d+$"))
        .Select(row => new ItemCandidate(
            row.ID,
            itemNames.Weapons.GetValueOrDefault(row.ID) ?? $"Weapon {row.ID}",
            Math.Max(0, GetCellInt(row, "properStrength", 0)),
            Math.Max(0, GetCellInt(row, "properAgility", 0)),
            Math.Max(0, GetCellInt(row, "properMagic", 0)),
            Math.Max(0, GetCellInt(row, "properFaith", 0)),
            row.ID < 1_200_000 &&
                !string.Equals(
                    itemNames.Weapons.GetValueOrDefault(row.ID),
                    "Fists",
                    StringComparison.OrdinalIgnoreCase)))
        .OrderBy(row => row.Id)
        .ToList();
    var protectorParam = ReadParam("EquipParamProtector.param");
    var armorBySlot = protectorParam.Rows
        // The English item table filters unused/unnamed parameter rows while
        // retaining every legitimate armor piece, including equipment that is
        // never sold or placed as ordinary loot.
        // IDs below 10,000 are character-creator hair/body entries. The
        // 900,000+ range holds invisible, no-travel, and transformation parts
        // rather than player armor. Neither range is safe for class previews
        // or equipped starting gear.
        .Where(row => row.ID is >= 10_000 and < 900_000)
        .Where(row => itemNames.Armor.ContainsKey(row.ID))
        .Where(row => (row.ID / 1000) % 10 is >= 0 and <= 3)
        .Select(row => new
        {
            Slot = (row.ID / 1000) % 10,
            Item = new ItemCandidate(
                row.ID,
                itemNames.Armor.GetValueOrDefault(row.ID) ?? $"Armor {row.ID}"),
        })
        .GroupBy(row => row.Slot)
        .ToDictionary(group => group.Key, group => group.Select(row => row.Item).ToList());
    var startingEquipmentPools = new StartingEquipmentPools(
        weapons,
        armorBySlot.GetValueOrDefault(0, new()),
        armorBySlot.GetValueOrDefault(1, new()),
        armorBySlot.GetValueOrDefault(2, new()),
        armorBySlot.GetValueOrDefault(3, new()));

    return new RandomizerParamData(
        gifts,
        enemyDropLots,
        worldItemLots,
        shopEntries,
        startingEquipmentPools);
}

static ItemNameLookup ReadEnglishItemNames(string itemMessagePath)
{
    var binder = BND3.Read(itemMessagePath);
    Dictionary<int, string> ReadTable(string fileName)
    {
        var file = binder.Files.FirstOrDefault(entry =>
            Path.GetFileName(entry.Name).Equals(
                fileName, StringComparison.OrdinalIgnoreCase));
        if (file is null)
            return new();
        return FMG.Read(file.Bytes).Entries
            .Where(entry => !string.IsNullOrWhiteSpace(entry.Text))
            .GroupBy(entry => entry.ID)
            .ToDictionary(group => group.Key, group => group.First().Text.Trim());
    }

    return new ItemNameLookup(
        ReadTable("Item_name_.fmg"),
        ReadTable("Weapon_name_.fmg"),
        ReadTable("Armor_name_.fmg"),
        ReadTable("Accessory_name_.fmg"),
        ReadTable("Magic_name_.fmg"));
}

static Dictionary<string, string> ReadEnglishBossNames(
    string itemMessagePath,
    List<EnemySlotRecord> slots)
{
    var binder = BND3.Read(itemMessagePath);
    var file = binder.Files.First(entry =>
        Path.GetFileName(entry.Name).Equals(
            "NPC_name_.fmg", StringComparison.OrdinalIgnoreCase));
    var names = FMG.Read(file.Bytes).Entries
        .Where(entry => !string.IsNullOrWhiteSpace(entry.Text))
        .GroupBy(entry => entry.ID)
        .ToDictionary(group => group.Key, group => group.First().Text.Trim());
    return slots
        .Where(slot => IsBossModel(slot.ModelName))
        .Select(slot => slot.ModelName)
        .Distinct()
        .Select(modelName => new
        {
            ModelName = modelName,
            NameId = GetBossNameId(modelName) ??
                (int.TryParse(modelName.AsSpan(1), out var value)
                    ? (short)value
                    : (short)-1),
        })
        .Where(entry => names.ContainsKey(entry.NameId))
        .ToDictionary(
            entry => entry.ModelName,
            entry => names[entry.NameId]);
}

static EnemyMetadataLookup ReadEnemyMetadata(
    string gameParamPath,
    string paramdefPath)
{
    var binder = BND3.Read(gameParamPath);
    var paramdefs = BND3.Read(paramdefPath).Files
        .Select(file => PARAMDEF.Read(file.Bytes))
        .ToList();
    PARAM ReadParam(string suffix)
    {
        var file = binder.Files.Single(entry =>
            entry.Name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));
        var param = PARAM.Read(file.Bytes);
        ApplyCompatibleParamdef(param, paramdefs);
        return param;
    }

    var npcRows = ReadParam("NpcParam.param").Rows.ToDictionary(
        row => row.ID,
        row => new NpcMetadata(
            GetCellInt(row, "teamType"),
            GetCellInt(row, "npcType"),
            GetCellInt(row, "moveType"),
            GetCellFloat(row, "hitHeight"),
            GetCellFloat(row, "hitRadius"),
            GetCellFloat(row, "hitYOffset"),
            GetCellInt(row, "hp"),
            GetCellInt(row, "getSoul")));
    var thinkRows = ReadParam("NpcThinkParam.param").Rows.ToDictionary(
        row => row.ID,
        row => new ThinkMetadata(
            GetCellFloat(row, "BattleStartDist"),
            GetCellFloat(row, "eye_dist"),
            GetCellFloat(row, "ear_dist"),
            GetCellInt(row, "disablePathMove") != 0,
            GetCellInt(row, "battleGoalID")));
    return new EnemyMetadataLookup(npcRows, thinkRows);
}

static StartingData ReadStartingData(
    BND3 gameParam,
    string paramdefPath)
{
    var paramdefBinder = BND3.Read(paramdefPath);
    var paramdefs = paramdefBinder.Files
        .Select(file => PARAMDEF.Read(file.Bytes))
        .ToList();
    var charaFile = gameParam.Files.Single(file =>
        file.Name.EndsWith("CharaInitParam.param", StringComparison.OrdinalIgnoreCase));
    var charaParam = PARAM.Read(charaFile.Bytes);
    if (!charaParam.ApplyParamdefCarefully(paramdefs))
    {
        var compatibleLayout = paramdefs.SingleOrDefault(definition =>
            definition.ParamType == charaParam.ParamType &&
            definition.GetRowSize() == charaParam.DetectedSize);
        if (compatibleLayout == null)
            throw new InvalidDataException("Incompatible CharaInitParam layout.");
        charaParam.ApplyParamdef(compatibleLayout);
    }

    var classDefinitions = new[]
    {
        ("warrior", "Warrior", 3000, 2000),
        ("knight", "Knight", 3001, 2001),
        ("wanderer", "Wanderer", 3002, 2002),
        ("thief", "Thief", 3003, 2003),
        ("bandit", "Bandit", 3004, 2004),
        ("hunter", "Hunter", 3005, 2005),
        ("sorcerer", "Sorcerer", 3006, 2006),
        ("pyromancer", "Pyromancer", 3007, 2007),
        ("cleric", "Cleric", 3008, 2008),
        ("deprived", "Deprived", 3009, 2009),
    };
    var classes = classDefinitions.Select(definition => new StartingClassRecord(
        definition.Item1,
        definition.Item2,
        definition.Item3,
        definition.Item4,
        RowCells(charaParam.Rows.Single(row => row.ID == definition.Item3)),
        RowCells(charaParam.Rows.Single(row => row.ID == definition.Item4))))
        .ToList();

    var itemLotFile = gameParam.Files.Single(file =>
        file.Name.EndsWith("ItemLotParam.param", StringComparison.OrdinalIgnoreCase));
    var itemLotParam = PARAM.Read(itemLotFile.Bytes);
    ApplyCompatibleParamdef(itemLotParam, paramdefs);
    var lotDefinitions = StartingLotDefinitions();
    var itemLots = lotDefinitions.SelectMany(definition =>
        definition.Value
            .Where(role => role.Value.HasValue)
            .Select(role =>
            {
                var rowId = role.Value!.Value;
                return new StartingItemLotRecord(
                    definition.Key,
                    role.Key,
                    rowId,
                    RowCells(itemLotParam.Rows.Single(row => row.ID == rowId)));
            }))
        .ToList();
    return new StartingData(classes, itemLots);
}

static Dictionary<string, Dictionary<string, int?>> StartingLotDefinitions() => new()
{
    ["warrior"] = new() { ["weapon"] = 1810100, ["offhand"] = 1810110, ["special"] = null },
    ["knight"] = new() { ["weapon"] = 1810120, ["offhand"] = 1810130, ["special"] = null },
    ["wanderer"] = new() { ["weapon"] = 1810140, ["offhand"] = 1810150, ["special"] = null },
    ["thief"] = new() { ["weapon"] = 1810160, ["offhand"] = 1810170, ["special"] = null },
    ["bandit"] = new() { ["weapon"] = 1810180, ["offhand"] = 1810190, ["special"] = null },
    ["hunter"] = new() { ["weapon"] = 1810200, ["offhand"] = 1810210, ["special"] = 1810220 },
    ["sorcerer"] = new() { ["weapon"] = 1810230, ["offhand"] = 1810240, ["special"] = 1810250 },
    ["pyromancer"] = new() { ["weapon"] = 1810260, ["offhand"] = 1810270, ["special"] = 1810280 },
    ["cleric"] = new() { ["weapon"] = 1810290, ["offhand"] = 1810300, ["special"] = 1810310 },
    ["deprived"] = new() { ["weapon"] = 1810320, ["offhand"] = 1810330, ["special"] = null },
};

static void ApplyCompatibleParamdef(PARAM param, List<PARAMDEF> paramdefs)
{
    if (param.ApplyParamdefCarefully(paramdefs))
        return;
    var compatibleLayout = paramdefs.SingleOrDefault(definition =>
        definition.ParamType == param.ParamType &&
        definition.GetRowSize() == param.DetectedSize);
    if (compatibleLayout == null)
        throw new InvalidDataException($"Incompatible layout for {param.ParamType}.");
    param.ApplyParamdef(compatibleLayout);
}

static Dictionary<string, object> RowCells(PARAM.Row row) =>
    row.Cells.ToDictionary(cell => cell.Def.InternalName, cell => cell.Value);

static bool IsGameplayMap(string mapId)
{
    if (mapId.Length < 3 || mapId[0] != 'm' || mapId[1] != '1')
        return false;
    return mapId[2] is >= '0' and <= '8';
}

static string NormalizeAiMapId(string mapId) =>
    mapId == "m12_00_00_01" ? "m12_00_00_00" : mapId;

static List<LUAINFO.Goal> ReadLuaGoals(string bundlePath)
{
    var binder = BND3.Read(bundlePath);
    var infoFile = binder.Files.SingleOrDefault(file => file.ID == 1_000_001)
        ?? throw new InvalidDataException(
            $"LUAINFO entry is missing from {Path.GetFileName(bundlePath)}.");
    return LUAINFO.Read(infoFile.Bytes).Goals;
}

static bool IsBossModel(string modelName) => modelName is
    "c2230" or "c2231" or "c2232" or "c2240" or "c2250" or "c2320" or
    "c2360" or "c2730" or "c3230" or "c3320" or "c3471" or "c4100" or
    "c4500" or "c4510" or "c5200" or "c5210" or "c5220" or "c5230" or "c5250" or
    "c5260" or "c5270" or "c5271" or "c5280" or "c5290" or "c5320" or
    "c5350" or "c5351" or "c5370" or "c5390";

static short? GetBossNameId(string modelName) => modelName switch
{
    "c2230" => 2231,
    "c2231" => 2230,
    "c2232" => 2232,
    "c2240" => 2240,
    "c2250" => 2250,
    "c2320" => 2320,
    "c2360" => 2360,
    "c2730" => 2730,
    "c3230" => 3230,
    "c3320" => 3320,
    "c3420" => 3420,
    "c3421" => 3421,
    "c3430" => 3430,
    "c3471" => 3471,
    "c3520" => 3520,
    "c4100" => 4100,
    "c4500" => 4500,
    "c4510" => 4510,
    "c5200" => 5200,
    "c5210" => 5210,
    "c5220" => 5220,
    "c5230" => 5230,
    "c5250" => 5250,
    "c5260" => 5260,
    "c5270" => 5270,
    "c5271" => 5270,
    "c5280" => 5280,
    "c5290" => 5290,
    "c5320" => 5320,
    "c5350" => 5350,
    "c5370" => 5370,
    "c5390" => 5390,
    _ => null,
};

static bool IsPrimaryBossSlot(EnemySlotRecord slot)
{
    if (slot.ModelName.Length != 5 ||
        !int.TryParse(slot.ModelName[1..], out var modelId))
        return false;
    return slot.NpcParamId == modelId * 100 && slot.ThinkParamId > 1000;
}

static PatchReport PatchEnemies(
    string gameDirectory,
    string catalogPath,
    string placementsPath,
    string outputDirectory,
    JsonSerializerOptions jsonOptions)
{
    if (!File.Exists(catalogPath))
        throw new FileNotFoundException("Catalog not found.", catalogPath);
    if (!File.Exists(placementsPath))
        throw new FileNotFoundException("Placements file not found.", placementsPath);

    var relativeOutput = Path.GetRelativePath(gameDirectory, outputDirectory);
    if (!relativeOutput.StartsWith("..", StringComparison.Ordinal) &&
        !Path.IsPathRooted(relativeOutput))
    {
        throw new InvalidOperationException(
            "Patch output cannot be placed inside the game installation.");
    }

    var catalog = JsonSerializer.Deserialize<GameCatalog>(
        File.ReadAllText(catalogPath), jsonOptions)
        ?? throw new InvalidDataException("Invalid catalog.");
    if (catalog.SchemaVersion != SchemaVersion)
        throw new InvalidDataException(
            $"Catalog schema {catalog.SchemaVersion} is obsolete. " +
            "Import the clean game data again.");
    using var placementDocument = JsonDocument.Parse(File.ReadAllText(placementsPath));
    var placementsRoot = placementDocument.RootElement.GetProperty("placements");
    IEnumerable<PatchPlacement> ReadEnemyPlacements(string propertyName)
    {
        if (!placementsRoot.TryGetProperty(propertyName, out var array))
            return Enumerable.Empty<PatchPlacement>();
        return array.EnumerateArray()
            .Where(element =>
                element.TryGetProperty("targetNpcParamId", out _) &&
                element.TryGetProperty("targetThinkParamId", out _))
            .Select(element => new PatchPlacement(
                element.GetProperty("slot").GetString()
                    ?? throw new InvalidDataException("Placement has no slot."),
                element.GetProperty("map").GetString()
                    ?? throw new InvalidDataException("Placement has no map."),
                element.TryGetProperty("targetModelName", out var modelName)
                    ? modelName.GetString()
                        ?? throw new InvalidDataException("Placement has no target model.")
                    : "",
                element.GetProperty("targetNpcParamId").GetInt32(),
                element.GetProperty("targetThinkParamId").GetInt32(),
                element.GetProperty("targetBattleGoalId").GetInt32(),
                element.GetProperty("sourceNpcParamId").GetInt32(),
                element.TryGetProperty("scaledNpcParamId", out var scaledNpc) &&
                    scaledNpc.ValueKind == JsonValueKind.Number
                        ? scaledNpc.GetInt32()
                        : null,
                element.TryGetProperty("entityId", out var entityId)
                    ? entityId.GetInt32()
                    : -1,
                element.TryGetProperty("groundY", out var groundY) &&
                    groundY.ValueKind == JsonValueKind.Number
                        ? groundY.GetSingle()
                        : null,
                element.TryGetProperty("linkedDragonGroup", out var dragonGroup) &&
                    dragonGroup.ValueKind == JsonValueKind.String ||
                element.TryGetProperty("linkedEnemyGroup", out var enemyGroup) &&
                    enemyGroup.ValueKind == JsonValueKind.String))
            .Where(placement =>
                placement.TargetNpcParamId >= 0 && placement.TargetThinkParamId >= 0);
    }
    var regularEnemyPlacements = ReadEnemyPlacements("enemies").ToList();
    var bossPlacements = ReadEnemyPlacements("bosses").ToList();
    var slotsById = catalog.EnemySlots.ToDictionary(slot => slot.Id);
    foreach (var placement in regularEnemyPlacements)
    {
        if (!slotsById.TryGetValue(placement.SlotId, out var slot) ||
            (slot.TeamType != 0 &&
             slot.ModelName != "c3501" &&
             !placement.LinkedEnemyGroup) ||
            slot.ModelName == "c0000" ||
            slot.NpcParamId != placement.SourceNpcParamId ||
            placement.TargetNpcParamId < 0 ||
            placement.TargetThinkParamId < 0)
        {
            throw new InvalidDataException(
                $"Protected or obsolete regular-enemy placement: {placement.SlotId}. " +
                "Generate a new package from a fresh catalog.");
        }
    }
    var bossSlotIds = catalog.BossSlots
        .Concat(catalog.EnemySlots.Where(slot =>
            IsBossModel(slot.ModelName) && IsPrimaryBossSlot(slot)))
        .Select(slot => slot.Id)
        .ToHashSet();
    if (bossPlacements.Any(placement => !bossSlotIds.Contains(placement.SlotId)))
        throw new InvalidDataException("A boss placement targets a protected slot.");
    var allEnemyPlacements = regularEnemyPlacements
        .Concat(bossPlacements)
        .DistinctBy(placement => placement.SlotId)
        .ToList();
    var enemyPlacements = allEnemyPlacements
        .GroupBy(placement => placement.MapId)
        .ToList();
    var startingPlacements = new List<StartingPlacement>();
    if (placementsRoot.TryGetProperty("startingClasses", out var startingElement))
    {
        startingPlacements = startingElement
            .EnumerateArray()
            .Select(element =>
            {
                RandomStartingEquipment? equipment = null;
                if (element.TryGetProperty("equipment", out var equipmentElement) &&
                    equipmentElement.ValueKind == JsonValueKind.Object)
                {
                    int ItemId(string name) =>
                        equipmentElement.GetProperty(name).GetProperty("id").GetInt32();
                    int? OptionalItemId(string name) =>
                        equipmentElement.TryGetProperty(name, out var item) &&
                        item.ValueKind == JsonValueKind.Object
                            ? item.GetProperty("id").GetInt32()
                            : null;
                    equipment = new RandomStartingEquipment(
                        ItemId("pickupWeapon"),
                        ItemId("pickupOffhand"),
                        OptionalItemId("pickupSpecial"),
                        ItemId("helm"),
                        ItemId("armor"),
                        ItemId("gauntlets"),
                        ItemId("legs"));
                }
                return new StartingPlacement(
                    element.GetProperty("slot").GetString()
                        ?? throw new InvalidDataException("Class placement has no slot."),
                    element.GetProperty("statsFrom").GetString()
                        ?? throw new InvalidDataException("Class placement has no statsFrom."),
                    element.GetProperty("equipmentFrom").GetString()
                        ?? throw new InvalidDataException("Class placement has no equipmentFrom."),
                    element.GetProperty("randomizeStats").GetBoolean(),
                    element.GetProperty("randomizeEquipment").GetBoolean(),
                    equipment);
            })
            .ToList();
    }
    List<RowPlacement> ReadRowPlacements(string propertyName)
    {
        if (!placementsRoot.TryGetProperty(propertyName, out var element))
            return new List<RowPlacement>();
        return element.EnumerateArray()
            .Select(row => new RowPlacement(
                row.GetProperty("rowId").GetInt32(),
                row.GetProperty("sourceRowId").GetInt32()))
            .ToList();
    }
    var giftPlacements = ReadRowPlacements("gifts");
    var enemyDropPlacements = ReadRowPlacements("enemyDrops");
    var worldItemPlacements = ReadRowPlacements("items");
    var shopPlacements = ReadRowPlacements("shops");

    Directory.CreateDirectory(outputDirectory);
    var patchedMaps = new List<PatchedMap>();
    var changedSlots = 0;

    foreach (var mapGroup in enemyPlacements)
    {
        var relativeMapPath = $"map/MapStudio/{mapGroup.Key}.msb";
        var sourceRecord = catalog.SourceFiles.SingleOrDefault(
            source => source.Path.Equals(relativeMapPath, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidDataException($"Map missing from catalog: {mapGroup.Key}");
        var sourcePath = Path.Combine(
            gameDirectory, relativeMapPath.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(sourcePath))
            throw new FileNotFoundException("Source map not found.", sourcePath);

        var sourceHashBefore = HashFile(sourcePath);
        if (!sourceHashBefore.Equals(sourceRecord.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Map {mapGroup.Key} changed after the catalog was extracted. " +
                "Run the scan again.");
        }

        var msb = MSB1.Read(sourcePath);
        var allMapEnemies = msb.Parts.Enemies
            .Cast<MSB1.Part.EnemyBase>()
            .Concat(msb.Parts.DummyEnemies);
        var enemiesByName = allMapEnemies.ToDictionary(
            enemy => enemy.Name, StringComparer.Ordinal);
        var originalEnemies = allMapEnemies.ToDictionary(
            enemy => enemy.Name,
            SnapshotEnemy,
            StringComparer.Ordinal);
        var mapChanges = 0;
        foreach (var placement in mapGroup)
        {
            var separator = placement.SlotId.IndexOf(':');
            var enemyName = separator >= 0
                ? placement.SlotId[(separator + 1)..]
                : placement.SlotId;
            if (!enemiesByName.TryGetValue(enemyName, out var enemy))
                throw new InvalidDataException($"Slot not found: {placement.SlotId}");

            var targetModelName = string.IsNullOrWhiteSpace(placement.TargetModelName)
                ? enemy.ModelName
                : placement.TargetModelName;
            if (enemy.ModelName == targetModelName &&
                enemy.NPCParamID == placement.EffectiveNpcParamId &&
                enemy.ThinkParamID == placement.TargetThinkParamId)
                continue;
            if (!msb.Models.Enemies.Any(model => model.Name == targetModelName))
            {
                msb.Models.Enemies.Add(new MSB1.Model.Enemy
                {
                    Name = targetModelName,
                    SibPath = $@"N:\FRPG\data\Model\chr\{targetModelName}.sib",
                });
            }
            var modelChanged = enemy.ModelName != targetModelName;
            enemy.ModelName = targetModelName;
            enemy.NPCParamID = placement.EffectiveNpcParamId;
            enemy.ThinkParamID = placement.TargetThinkParamId;
            if (placement.GroundY.HasValue)
                enemy.Position = new System.Numerics.Vector3(
                    enemy.Position.X,
                    placement.GroundY.Value,
                    enemy.Position.Z);
            if (modelChanged || placement.GroundY.HasValue)
            {
                // Initial/damage animation IDs belong to the original character
                // model. Retaining them can leave a replacement in a frozen bind
                // pose and prevent its AI from entering combat.
                enemy.InitAnimID = -1;
                enemy.DamageAnimID = -1;
            }
            mapChanges++;
        }

        if (mapChanges == 0)
            continue;

        var outputPath = Path.Combine(
            outputDirectory, "mod", "map", "MapStudio", $"{mapGroup.Key}.msb");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        msb.Write(outputPath);
        var verification = MSB1.Read(outputPath);
        if (verification.Parts.Enemies.Count != msb.Parts.Enemies.Count ||
            verification.Parts.DummyEnemies.Count != msb.Parts.DummyEnemies.Count)
            throw new InvalidDataException($"Invalid round-trip for map {mapGroup.Key}.");
        var verifiedEnemies = verification.Parts.Enemies
            .Cast<MSB1.Part.EnemyBase>()
            .Concat(verification.Parts.DummyEnemies)
            .ToDictionary(
            enemy => enemy.Name, StringComparer.Ordinal);
        var placementsByName = mapGroup.ToDictionary(
            placement =>
            {
                var separator = placement.SlotId.IndexOf(':');
                return separator >= 0
                    ? placement.SlotId[(separator + 1)..]
                    : placement.SlotId;
            },
            StringComparer.Ordinal);
        var placedNames = mapGroup
            .Select(placement =>
            {
                var separator = placement.SlotId.IndexOf(':');
                return separator >= 0
                    ? placement.SlotId[(separator + 1)..]
                    : placement.SlotId;
            })
            .ToHashSet(StringComparer.Ordinal);
        foreach (var (name, original) in originalEnemies)
        {
            var verified = verifiedEnemies[name];
            var expectedY = placementsByName.TryGetValue(name, out var placement)
                ? placement.GroundY
                : null;
            AssertSpawnUnchanged(original, verified, mapGroup.Key, expectedY);
            if (!placedNames.Contains(name) &&
                SnapshotEnemy(verified) != original)
            {
                throw new InvalidDataException(
                    $"Unselected enemy or NPC changed in {mapGroup.Key}: {name}.");
            }
        }
        foreach (var placement in mapGroup)
        {
            var separator = placement.SlotId.IndexOf(':');
            var enemyName = separator >= 0
                ? placement.SlotId[(separator + 1)..]
                : placement.SlotId;
            var verifiedEnemy = verifiedEnemies[enemyName];
            var expectedModel = string.IsNullOrWhiteSpace(placement.TargetModelName)
                ? enemiesByName[enemyName].ModelName
                : placement.TargetModelName;
            if (!verification.Models.Enemies.Any(model => model.Name == expectedModel))
                throw new InvalidDataException(
                    $"Enemy model declaration did not persist: {expectedModel} in {mapGroup.Key}.");
            if (verifiedEnemy.ModelName != expectedModel ||
                verifiedEnemy.NPCParamID != placement.EffectiveNpcParamId ||
                verifiedEnemy.ThinkParamID != placement.TargetThinkParamId ||
                (placement.GroundY.HasValue &&
                 verifiedEnemy.Position.Y != placement.GroundY.Value))
                throw new InvalidDataException(
                    $"Enemy placement did not persist: {placement.SlotId}.");
            var original = originalEnemies[enemyName];
            if (expectedModel != original.ModelName &&
                (verifiedEnemy.InitAnimID != -1 || verifiedEnemy.DamageAnimID != -1))
            {
                throw new InvalidDataException(
                    $"Model-specific animations were not cleared: {placement.SlotId}.");
            }
        }
        if (!HashFile(sourcePath).Equals(sourceHashBefore, StringComparison.OrdinalIgnoreCase))
            throw new IOException($"Source file changed during patching: {mapGroup.Key}");

        changedSlots += mapChanges;
        patchedMaps.Add(new PatchedMap(
            mapGroup.Key,
            relativeMapPath,
            Path.GetRelativePath(outputDirectory, outputPath).Replace('\\', '/'),
            mapChanges,
            sourceHashBefore,
            HashFile(outputPath)));
    }

    var patchedLuaBundles = PatchLuaAiBundles(
        gameDirectory, outputDirectory, catalog, allEnemyPlacements);

    var patchedEvents = PatchBossNames(
        gameDirectory, outputDirectory, catalog, bossPlacements);

    // Enemy effects are normally spread across map-local SFX bundles. An enemy
    // moved to another map can otherwise attack correctly while its projectile
    // or elemental effect is invisible (for example, the Demonic Statue fire).
    // Make the transferable enemy effects globally available to this package.
    var patchedFfxBundle = allEnemyPlacements.Count > 0
        ? PatchEnemyEffects(gameDirectory, outputDirectory)
        : null;

    var patchedGameParam =
        allEnemyPlacements.Any(placement => placement.ScaledNpcParamId.HasValue) ||
        startingPlacements.Count > 0 ||
        giftPlacements.Count > 0 ||
        enemyDropPlacements.Count > 0 ||
        worldItemPlacements.Count > 0 ||
        shopPlacements.Count > 0
        ? PatchGameParam(
            gameDirectory,
            outputDirectory,
            catalog,
            allEnemyPlacements,
            startingPlacements,
            giftPlacements,
            enemyDropPlacements,
            worldItemPlacements,
            shopPlacements)
        : null;

    var report = new PatchReport(
        2,
        DateTimeOffset.UtcNow,
        outputDirectory,
        changedSlots,
        patchedMaps,
        patchedLuaBundles,
        patchedEvents,
        patchedFfxBundle,
        patchedGameParam);
    File.WriteAllText(
        Path.Combine(outputDirectory, "patch-manifest.json"),
        JsonSerializer.Serialize(report, jsonOptions) + Environment.NewLine);
    return report;
}

static PatchedFile PatchEnemyEffects(string gameDirectory, string outputDirectory)
{
    const string commonRelative = "sfx/FRPG_SfxBnd_CommonEffects.ffxbnd.dcx";
    var mapBundles = new[]
    {
        "m10", "m10_00", "m10_01", "m10_02", "m11", "m12", "m12_00",
        "m12_01", "m13", "m13_00", "m13_01", "m13_02", "m14", "m14_00",
        "m14_01", "m15", "m15_00", "m15_01", "m16", "m17", "m18",
        "m18_00", "m18_01",
    };
    var effectName = new Regex(@"f00([1-9][0-9]{4})\.ffx$", RegexOptions.IgnoreCase);
    var resourceName = new Regex(@"s([1-9][0-9]{4})\.(flver|tpf)$", RegexOptions.IgnoreCase);

    static BinderFile CopyFile(BinderFile file, int id) => new(
        file.Flags,
        id,
        file.Name,
        file.Bytes.ToArray())
    {
        CompressionType = file.CompressionType,
    };

    bool IsEnemyEffect(BinderFile file)
    {
        var name = Path.GetFileName(file.Name);
        var effectMatch = effectName.Match(name);
        if (effectMatch.Success)
            return int.Parse(effectMatch.Groups[1].Value) < 20_001;
        var resourceMatch = resourceName.Match(name);
        return resourceMatch.Success &&
            int.Parse(resourceMatch.Groups[1].Value) < 20_001;
    }

    var sourcePath = ResolveGamePath(gameDirectory, commonRelative);
    if (!File.Exists(sourcePath))
        throw new FileNotFoundException("Common enemy-effect bundle was not found.", sourcePath);
    var sourceHash = HashFile(sourcePath);
    var binder = BND3.Read(sourcePath);
    var existingNames = binder.Files
        .Select(file => file.Name)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);
    var nextIds = new Dictionary<int, int>
    {
        [0] = binder.Files.Where(file => file.ID < 100_000)
            .Select(file => file.ID).DefaultIfEmpty(0).Max(),
        [1] = binder.Files.Where(file => file.ID is >= 100_000 and < 200_000)
            .Select(file => file.ID).DefaultIfEmpty(100_000).Max(),
        [2] = binder.Files.Where(file => file.ID >= 200_000)
            .Select(file => file.ID).DefaultIfEmpty(200_000).Max(),
    };
    var additions = new List<BinderFile>();
    foreach (var mapId in mapBundles)
    {
        var relative = $"sfx/FRPG_SfxBnd_{mapId}.ffxbnd.dcx";
        var mapPath = ResolveGamePath(gameDirectory, relative);
        if (!File.Exists(mapPath))
            throw new FileNotFoundException("Map enemy-effect bundle was not found.", mapPath);
        var mapHash = HashFile(mapPath);
        foreach (var file in BND3.Read(mapPath).Files.Where(IsEnemyEffect))
        {
            if (!existingNames.Add(file.Name))
                continue;
            var group = file.ID < 100_000 ? 0 : file.ID < 200_000 ? 1 : 2;
            additions.Add(CopyFile(file, ++nextIds[group]));
        }
        if (!HashFile(mapPath).Equals(mapHash, StringComparison.OrdinalIgnoreCase))
            throw new IOException($"Source effect bundle changed during patching: {relative}");
    }

    if (additions.Count == 0)
        throw new InvalidDataException("No transferable enemy effects were found.");
    // The engine expects effect, texture, and model entries grouped by ID range.
    binder.Files.AddRange(additions.OrderBy(file => file.ID));
    var outputRelative = $"mod/{commonRelative}";
    var outputPath = ResolvePackagePath(outputDirectory, outputRelative);
    Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
    binder.Write(outputPath);

    var verification = BND3.Read(outputPath);
    var verifiedNames = verification.Files
        .Select(file => file.Name)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);
    if (!additions.Select(file => file.Name).All(verifiedNames.Contains))
        throw new InvalidDataException("Enemy effects did not persist in CommonEffects.");
    if (!HashFile(sourcePath).Equals(sourceHash, StringComparison.OrdinalIgnoreCase))
        throw new IOException("Source CommonEffects bundle changed during patching.");
    return new PatchedFile(
        commonRelative,
        outputRelative,
        sourceHash,
        HashFile(outputPath));
}

static List<PatchedFile> PatchLuaAiBundles(
    string gameDirectory,
    string outputDirectory,
    GameCatalog catalog,
    List<PatchPlacement> placements)
{
    const int luaGnlId = 1_000_000;
    const int luaInfoId = 1_000_001;
    var bundleRecords = catalog.SourceFiles
        .Where(source =>
            source.Path.StartsWith("script/m1", StringComparison.OrdinalIgnoreCase) &&
            source.Path.EndsWith(".luabnd.dcx", StringComparison.OrdinalIgnoreCase))
        .OrderBy(source => source.Path, StringComparer.OrdinalIgnoreCase)
        .ToList();
    var commonRecord = catalog.SourceFiles.SingleOrDefault(source =>
        source.Path.Equals(
            "script/aiCommon.luabnd.dcx",
            StringComparison.OrdinalIgnoreCase))
        ?? throw new InvalidDataException("aiCommon is missing from the catalog.");

    BND3 ReadBundle(SourceFile source)
    {
        var sourcePath = ResolveGamePath(gameDirectory, source.Path);
        AssertHash(sourcePath, source.Sha256, $"{source.Path} changed after extraction");
        return BND3.Read(sourcePath);
    }

    static LUAINFO ReadInfo(BND3 binder, string name)
    {
        var file = binder.Files.SingleOrDefault(entry => entry.ID == luaInfoId)
            ?? throw new InvalidDataException($"LUAINFO is missing from {name}.");
        return LUAINFO.Read(file.Bytes);
    }

    static LUAGNL ReadGlobals(BND3 binder, string name)
    {
        var file = binder.Files.SingleOrDefault(entry => entry.ID == luaGnlId)
            ?? throw new InvalidDataException($"LUAGNL is missing from {name}.");
        return LUAGNL.Read(file.Bytes);
    }

    var commonGoals = ReadInfo(
            ReadBundle(commonRecord),
            commonRecord.Path)
        .Goals.Select(goal => goal.ID)
        .ToHashSet();
    var sourceBundles = bundleRecords
        .Select(record =>
        {
            var binder = ReadBundle(record);
            return new LuaBundleSource(
                record,
                binder,
                ReadInfo(binder, record.Path),
                ReadGlobals(binder, record.Path));
        })
        .ToList();
    var transferableGoalIds = sourceBundles
        .SelectMany(bundle => bundle.Info.Goals)
        .Select(goal => goal.ID)
        .Concat(commonGoals)
        .ToHashSet();
    var results = new List<PatchedFile>();
    foreach (var mapGroup in placements
                 .GroupBy(placement => NormalizeAiMapId(placement.MapId))
                 .OrderBy(group => group.Key, StringComparer.Ordinal))
    {
        var targetRelative = $"script/{mapGroup.Key}.luabnd.dcx";
        var targetSource = bundleRecords.SingleOrDefault(record =>
            record.Path.Equals(
                targetRelative,
                StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidDataException(
                $"AI bundle missing from catalog: {targetRelative}");
        var targetPath = ResolveGamePath(gameDirectory, targetRelative);
        AssertHash(
            targetPath,
            targetSource.Sha256,
            $"{targetRelative} changed after extraction");
        var targetBinder = BND3.Read(targetPath);
        var targetInfoFile = targetBinder.Files.Single(file => file.ID == luaInfoId);
        var targetGnlFile = targetBinder.Files.Single(file => file.ID == luaGnlId);
        var targetInfo = LUAINFO.Read(targetInfoFile.Bytes);
        var targetGlobals = LUAGNL.Read(targetGnlFile.Bytes);
        static string GoalKey(LUAINFO.Goal goal) =>
            $"{goal.ID}\0{goal.Name}\0{goal.BattleInterrupt}\0" +
            $"{goal.LogicInterrupt}\0{goal.LogicInterruptName}";
        static bool ContainsAscii(byte[] bytes, string value)
        {
            var needle = Encoding.ASCII.GetBytes(value);
            if (needle.Length == 0 || needle.Length > bytes.Length)
                return false;
            for (var offset = 0; offset <= bytes.Length - needle.Length; offset++)
            {
                if (bytes.AsSpan(offset, needle.Length).SequenceEqual(needle))
                    return true;
            }
            return false;
        }

        var existingGoalIds = targetInfo.Goals
            .Select(goal => goal.ID)
            .ToHashSet();
        var existingGoalKeys = targetInfo.Goals
            .Select(GoalKey)
            .ToHashSet(StringComparer.Ordinal);
        var requiredGoalIds = mapGroup
            .Select(placement => placement.TargetBattleGoalId)
            .Distinct()
            .Order()
            .ToList();
        var missingGoalIds = requiredGoalIds
            .Where(id =>
                !existingGoalIds.Contains(id) &&
                !commonGoals.Contains(id) &&
                transferableGoalIds.Contains(id))
            .ToList();
        if (missingGoalIds.Count == 0)
            continue;

        var requiredEntries = new List<LuaAiEntry>();
        foreach (var goalId in missingGoalIds)
        {
            var source = sourceBundles.FirstOrDefault(bundle =>
                    bundle.Info.Goals.Any(goal =>
                        goal.ID == goalId && goal.BattleInterrupt))
                ?? sourceBundles.FirstOrDefault(bundle =>
                    bundle.Info.Goals.Any(goal => goal.ID == goalId));
            if (source == null)
            {
                throw new InvalidDataException(
                    $"No Lua AI goal {goalId} was found for {mapGroup.Key}. " +
                    "This replacement is not safe.");
            }
            var scriptPrefix = $"{goalId:D6}_";
            var goals = source.Info.Goals
                .Where(goal => goal.ID == goalId)
                .ToList();
            var logicScriptNames = goals
                .Select(goal => goal.LogicInterruptName)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => Path.GetFileName(name!))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var scripts = source.Binder.Files
                .Where(file =>
                    file.ID != luaGnlId &&
                    file.ID != luaInfoId &&
                    (Path.GetFileName(file.Name).StartsWith(
                         scriptPrefix,
                         StringComparison.OrdinalIgnoreCase) ||
                     logicScriptNames.Contains(Path.GetFileName(file.Name))))
                .ToList();
            if (scripts.Count == 0)
            {
                throw new InvalidDataException(
                    $"No Lua AI script for goal {goalId} was found in " +
                    $"{source.Record.Path}.");
            }
            var globals = source.Globals.Globals
                .Where(value => scripts.Any(script =>
                    ContainsAscii(script.Bytes, value)))
                .ToList();
            requiredEntries.Add(new LuaAiEntry(
                scripts,
                goals,
                globals));
        }

        var existingScriptNames = targetBinder.Files
            .Where(file => file.ID != luaGnlId && file.ID != luaInfoId)
            .Select(file => Path.GetFileName(file.Name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var existingGlobals = targetGlobals.Globals
            .ToHashSet(StringComparer.Ordinal);
        var nextFileId = targetBinder.Files
            .Where(file => file.ID < luaGnlId)
            .Select(file => file.ID)
            .DefaultIfEmpty(0)
            .Max();
        var metadataIndex = targetBinder.Files.FindIndex(file =>
            file.ID is luaGnlId or luaInfoId);
        if (metadataIndex < 0)
            metadataIndex = targetBinder.Files.Count;

        var expectedScriptNames = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase);
        var expectedGoalKeys = new HashSet<string>(StringComparer.Ordinal);
        var expectedGlobals = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in requiredEntries)
        {
            foreach (var file in entry.Scripts)
            {
                var scriptName = Path.GetFileName(file.Name);
                expectedScriptNames.Add(scriptName);
                if (!existingScriptNames.Add(scriptName))
                    continue;
                var copy = new BinderFile(
                    file.Flags,
                    ++nextFileId,
                    file.Name,
                    file.Bytes.ToArray())
                {
                    CompressionType = file.CompressionType,
                };
                targetBinder.Files.Insert(metadataIndex++, copy);
            }
            foreach (var value in entry.Globals)
                expectedGlobals.Add(value);
            var newGlobals = entry.Globals
                .Where(value => existingGlobals.Add(value))
                .ToList();
            targetGlobals.Globals.InsertRange(0, newGlobals);
            foreach (var goal in entry.Goals)
            {
                var goalKey = GoalKey(goal);
                expectedGoalKeys.Add(goalKey);
                if (!existingGoalKeys.Add(goalKey))
                    continue;
                existingGoalIds.Add(goal.ID);
                targetInfo.Goals.Insert(
                    0,
                    new LUAINFO.Goal(
                        goal.ID,
                        goal.Name,
                        goal.BattleInterrupt,
                        goal.LogicInterrupt,
                        goal.LogicInterruptName ?? ""));
            }
        }

        targetGnlFile.Bytes = targetGlobals.Write();
        targetInfoFile.Bytes = targetInfo.Write();
        var outputRelative = $"mod/{targetRelative}";
        var outputPath = ResolvePackagePath(outputDirectory, outputRelative);
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        targetBinder.Write(outputPath);

        var verification = BND3.Read(outputPath);
        var verifiedGoals = ReadInfo(verification, outputRelative)
            .Goals;
        var verifiedGoalIds = verifiedGoals
            .Select(goal => goal.ID)
            .ToHashSet();
        var verifiedGoalKeys = verifiedGoals
            .Select(GoalKey)
            .ToHashSet(StringComparer.Ordinal);
        var unavailable = requiredGoalIds
            .Where(id =>
                transferableGoalIds.Contains(id) &&
                !verifiedGoalIds.Contains(id) &&
                !commonGoals.Contains(id))
            .ToList();
        if (unavailable.Count > 0)
        {
            throw new InvalidDataException(
                $"Lua AI goals did not persist for {mapGroup.Key}: " +
                string.Join(", ", unavailable));
        }
        var verifiedScripts = verification.Files
            .Where(file => file.ID != luaGnlId && file.ID != luaInfoId)
            .Select(file => Path.GetFileName(file.Name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!existingScriptNames.IsSubsetOf(verifiedScripts))
            throw new InvalidDataException(
                $"Lua AI scripts did not persist for {mapGroup.Key}.");
        if (!expectedScriptNames.IsSubsetOf(verifiedScripts) ||
            !expectedGoalKeys.IsSubsetOf(verifiedGoalKeys))
        {
            throw new InvalidDataException(
                $"Required Lua AI entries did not persist for {mapGroup.Key}.");
        }
        var verifiedGlobals = ReadGlobals(verification, outputRelative)
            .Globals.ToHashSet(StringComparer.Ordinal);
        if (!expectedGlobals.IsSubsetOf(verifiedGlobals))
            throw new InvalidDataException(
                $"Required Lua AI globals did not persist for {mapGroup.Key}.");
        AssertHash(
            targetPath,
            targetSource.Sha256,
            $"Source AI bundle changed during patching: {mapGroup.Key}");
        results.Add(new PatchedFile(
            targetRelative,
            outputRelative,
            targetSource.Sha256,
            HashFile(outputPath)));
    }
    return results;
}

static void InsertEventInstruction(
    EMEVD.Event entry,
    int index,
    EMEVD.Instruction instruction)
{
    foreach (var parameter in entry.Parameters.Where(parameter =>
                 parameter.InstructionIndex >= index))
        parameter.InstructionIndex++;
    entry.Instructions.Insert(index, instruction);
}

static void RemoveEventInstruction(EMEVD.Event entry, int index)
{
    if (entry.Parameters.Any(parameter =>
            parameter.InstructionIndex == index))
    {
        throw new InvalidDataException(
            $"Cannot remove parameterized instruction {index} from event {entry.ID}.");
    }
    foreach (var parameter in entry.Parameters.Where(parameter =>
                 parameter.InstructionIndex > index))
        parameter.InstructionIndex--;
    entry.Instructions.RemoveAt(index);
}

static List<PatchedFile> PatchBossNames(
    string gameDirectory,
    string outputDirectory,
    GameCatalog catalog,
    List<PatchPlacement> placements)
{
    var results = new List<PatchedFile>();
    foreach (var mapGroup in placements
                 .Where(placement =>
                     placement.EntityId >= 0 &&
                     GetBossNameId(placement.TargetModelName).HasValue)
                 .GroupBy(placement => placement.MapId))
    {
        var namesByEntity = mapGroup
            .GroupBy(placement => placement.EntityId)
            .ToDictionary(
                group => group.Key,
                group => GetBossNameId(group.First().TargetModelName)!.Value);
        var bossSlotsById = catalog.BossSlots
            .Concat(catalog.EnemySlots.Where(slot =>
                IsBossModel(slot.ModelName) && IsPrimaryBossSlot(slot)))
            .DistinctBy(slot => slot.Id)
            .ToDictionary(slot => slot.Id);
        var randomizedEntityIds = mapGroup
            .Where(placement =>
                bossSlotsById.TryGetValue(placement.SlotId, out var slot) &&
                slot.ModelName != placement.TargetModelName)
            .Select(placement => placement.EntityId)
            .ToHashSet();
        var relativeSource = $"event/{mapGroup.Key}.emevd.dcx";
        var sourceRecord = catalog.SourceFiles.SingleOrDefault(source =>
            source.Path.Equals(relativeSource, StringComparison.OrdinalIgnoreCase));
        if (sourceRecord == null)
            continue;
        var sourcePath = Path.Combine(
            gameDirectory, relativeSource.Replace('/', Path.DirectorySeparatorChar));
        AssertHash(sourcePath, sourceRecord.Sha256, $"Event {mapGroup.Key} changed after extraction");

        var emevd = EMEVD.Read(sourcePath);
        var changed = 0;
        var patchAsylumIntro =
            mapGroup.Key == "m18_01_00_00" &&
            mapGroup.Any(placement =>
                placement.SlotId.EndsWith(":c2232_0000", StringComparison.Ordinal) &&
                placement.TargetModelName != "c2232");
        if (patchAsylumIntro)
        {
            var intro = emevd.Events.Single(entry => entry.ID == 11810310);
            var removed = 0;
            for (var index = intro.Instructions.Count - 1; index >= 0; index--)
            {
                var instruction = intro.Instructions[index];
                if (instruction.ArgData.Length < 4 ||
                    BitConverter.ToInt32(instruction.ArgData, 0) != 1810800 ||
                    !((instruction.Bank == 2004 &&
                       instruction.ID is 8 or 9 or 21) ||
                      (instruction.Bank == 2003 && instruction.ID == 18)))
                    continue;
                RemoveEventInstruction(intro, index);
                removed++;
            }
            changed += removed;

            var highWarp = intro.Instructions.Single(instruction =>
                instruction.Bank == 2004 &&
                instruction.ID == 41 &&
                instruction.ArgData.Length >= 12 &&
                BitConverter.ToInt32(instruction.ArgData, 0) == 1810800 &&
                BitConverter.ToInt32(instruction.ArgData, 8) == 1812305);
            BitConverter.GetBytes(1812300).CopyTo(highWarp.ArgData, 8);
            changed++;

            // The vanilla drop sequence disables AI before playing model-specific
            // animations. Re-enable it before the event terminates; instructions
            // appended after EndEvent are unreachable.
            var terminalIndex = intro.Instructions.FindLastIndex(instruction =>
                instruction.Bank == 2006 && instruction.ID == 2);
            if (terminalIndex < 0)
                throw new InvalidDataException(
                    "Asylum intro event has no terminal instruction.");
            InsertEventInstruction(
                intro,
                terminalIndex,
                new EMEVD.Instruction(
                    2004,
                    1,
                    new object[] { 1810800, 1 }));
            changed++;
        }
        foreach (var entry in emevd.Events)
        {
            for (var index = 0; index < entry.Instructions.Count; index++)
            {
                var instruction = entry.Instructions[index];
                if (instruction.Bank != 2003 ||
                    instruction.ID != 11 ||
                    instruction.ArgData.Length != 12)
                    continue;
                var entityId = BitConverter.ToInt32(instruction.ArgData, 4);
                if (!namesByEntity.TryGetValue(entityId, out var nameId))
                    continue;
                var nameBytes = BitConverter.GetBytes(nameId);
                if (instruction.ArgData[10] != nameBytes[0] ||
                    instruction.ArgData[11] != nameBytes[1])
                {
                    instruction.ArgData[10] = nameBytes[0];
                    instruction.ArgData[11] = nameBytes[1];
                    changed++;
                }
                if (!randomizedEntityIds.Contains(entityId))
                    continue;
                var nextIsEnable =
                    index + 1 < entry.Instructions.Count &&
                    entry.Instructions[index + 1].Bank == 2004 &&
                    entry.Instructions[index + 1].ID == 1 &&
                    entry.Instructions[index + 1].ArgData.Length == 8 &&
                    BitConverter.ToInt32(
                        entry.Instructions[index + 1].ArgData, 0) == entityId &&
                    BitConverter.ToInt32(
                        entry.Instructions[index + 1].ArgData, 4) == 1;
                if (nextIsEnable)
                    continue;
                InsertEventInstruction(
                    entry,
                    index + 1,
                    new EMEVD.Instruction(
                        2004,
                        1,
                        new object[] { entityId, 1 }));
                index++;
                changed++;
            }
        }
        if (changed == 0)
            continue;

        var outputRelative = $"mod/{relativeSource}";
        var outputPath = Path.Combine(
            outputDirectory, outputRelative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        emevd.Write(outputPath);
        var verification = EMEVD.Read(outputPath);
        if (patchAsylumIntro)
        {
            var intro = verification.Events.Single(entry => entry.ID == 11810310);
            var terminalIndex = intro.Instructions.FindLastIndex(instruction =>
                instruction.Bank == 2006 && instruction.ID == 2);
            var enableIndex = intro.Instructions.FindIndex(instruction =>
                instruction.Bank == 2004 &&
                instruction.ID == 1 &&
                instruction.ArgData.Length == 8 &&
                BitConverter.ToInt32(instruction.ArgData, 0) == 1810800 &&
                BitConverter.ToInt32(instruction.ArgData, 4) == 1);
            if (intro.Instructions.Any(instruction =>
                    instruction.ArgData.Length >= 4 &&
                    BitConverter.ToInt32(instruction.ArgData, 0) == 1810800 &&
                    ((instruction.Bank == 2004 &&
                      instruction.ID is 8 or 9 or 21) ||
                     (instruction.Bank == 2003 && instruction.ID == 18))) ||
                !intro.Instructions.Any(instruction =>
                    instruction.Bank == 2004 &&
                    instruction.ID == 41 &&
                    instruction.ArgData.Length >= 12 &&
                    BitConverter.ToInt32(instruction.ArgData, 0) == 1810800 &&
                    BitConverter.ToInt32(instruction.ArgData, 8) == 1812300) ||
                enableIndex < 0 ||
                terminalIndex < 0 ||
                enableIndex >= terminalIndex)
            {
                throw new InvalidDataException(
                    "Randomized Asylum boss intro did not persist safely.");
            }
        }
        foreach (var instruction in verification.Events
                     .SelectMany(entry => entry.Instructions)
                     .Where(value =>
                         value.Bank == 2003 &&
                         value.ID == 11 &&
                         value.ArgData.Length == 12))
        {
            var entityId = BitConverter.ToInt32(instruction.ArgData, 4);
            if (namesByEntity.TryGetValue(entityId, out var expectedNameId) &&
                BitConverter.ToInt16(instruction.ArgData, 10) != expectedNameId)
                throw new InvalidDataException(
                    $"Boss name did not persist for entity {entityId} in {mapGroup.Key}.");
        }
        foreach (var entry in verification.Events)
        {
            for (var index = 0; index + 1 < entry.Instructions.Count; index++)
            {
                var instruction = entry.Instructions[index];
                if (instruction.Bank != 2003 ||
                    instruction.ID != 11 ||
                    instruction.ArgData.Length != 12)
                    continue;
                var entityId = BitConverter.ToInt32(instruction.ArgData, 4);
                if (!randomizedEntityIds.Contains(entityId))
                    continue;
                var enable = entry.Instructions[index + 1];
                if (enable.Bank != 2004 ||
                    enable.ID != 1 ||
                    enable.ArgData.Length != 8 ||
                    BitConverter.ToInt32(enable.ArgData, 0) != entityId ||
                    BitConverter.ToInt32(enable.ArgData, 4) != 1)
                {
                    throw new InvalidDataException(
                        $"Randomized boss AI activation did not persist for " +
                        $"entity {entityId} in {mapGroup.Key}.");
                }
            }
        }
        results.Add(new PatchedFile(
            relativeSource,
            outputRelative,
            sourceRecord.Sha256,
            HashFile(outputPath)));
    }
    return results;
}

static PatchedFile? PatchGameParam(
    string gameDirectory,
    string outputDirectory,
    GameCatalog catalog,
    List<PatchPlacement> enemyPlacements,
    List<StartingPlacement> placements,
    List<RowPlacement> giftPlacements,
    List<RowPlacement> enemyDropPlacements,
    List<RowPlacement> worldItemPlacements,
    List<RowPlacement> shopPlacements)
{
    if (!enemyPlacements.Any(placement => placement.ScaledNpcParamId.HasValue) &&
        !placements.Any(placement =>
            placement.RandomizeStats || placement.RandomizeEquipment) &&
        giftPlacements.Count == 0 &&
        enemyDropPlacements.Count == 0 &&
        worldItemPlacements.Count == 0 &&
        shopPlacements.Count == 0)
        return null;

    const string relativeSource = "param/GameParam/GameParam.parambnd.dcx";
    var sourceRecord = catalog.SourceFiles.Single(source =>
        source.Path.Equals(relativeSource, StringComparison.OrdinalIgnoreCase));
    var sourcePath = Path.Combine(
        gameDirectory, relativeSource.Replace('/', Path.DirectorySeparatorChar));
    AssertHash(sourcePath, sourceRecord.Sha256, "GameParam changed after extraction");

    var paramdefPath = Path.Combine(
        gameDirectory, "paramdef", "paramdef.paramdefbnd.dcx");
    var paramdefs = BND3.Read(paramdefPath).Files
        .Select(file => PARAMDEF.Read(file.Bytes))
        .ToList();
    var binder = BND3.Read(sourcePath);
    var charaFile = binder.Files.Single(file =>
        file.Name.EndsWith("CharaInitParam.param", StringComparison.OrdinalIgnoreCase));
    var itemLotFile = binder.Files.Single(file =>
        file.Name.EndsWith("ItemLotParam.param", StringComparison.OrdinalIgnoreCase));
    var shopFile = binder.Files.Single(file =>
        file.Name.EndsWith("ShopLineupParam.param", StringComparison.OrdinalIgnoreCase));
    var npcFile = binder.Files.Single(file =>
        file.Name.EndsWith("NpcParam.param", StringComparison.OrdinalIgnoreCase));
    var charaParam = PARAM.Read(charaFile.Bytes);
    var itemLotParam = PARAM.Read(itemLotFile.Bytes);
    var shopParam = PARAM.Read(shopFile.Bytes);
    var npcParam = PARAM.Read(npcFile.Bytes);
    ApplyCompatibleParamdef(charaParam, paramdefs);
    ApplyCompatibleParamdef(itemLotParam, paramdefs);
    ApplyCompatibleParamdef(shopParam, paramdefs);
    ApplyCompatibleParamdef(npcParam, paramdefs);

    AddScaledNpcRows(
        npcParam,
        enemyPlacements.Where(placement => placement.ScaledNpcParamId.HasValue).ToList());

    var classes = catalog.StartingClasses.ToDictionary(entry => entry.Id);
    var classRows = classes.ToDictionary(
        pair => pair.Key,
        pair => new
        {
            Display = charaParam.Rows.Single(row => row.ID == pair.Value.DisplayRowId),
            Start = charaParam.Rows.Single(row => row.ID == pair.Value.StartRowId),
        });
    var classSnapshots = classRows.ToDictionary(
        pair => pair.Key,
        pair => new
        {
            Display = RowCells(pair.Value.Display),
            Start = RowCells(pair.Value.Start),
        });
    var startingLotDefinitions = StartingLotDefinitions();
    var vanillaStartingWeaponIds = new HashSet<int>();
    var vanillaStartingArmorIds = new HashSet<int>();
    foreach (var rows in classRows.Values)
    {
        foreach (var row in new[] { rows.Display, rows.Start })
        {
            foreach (var field in new[]
                     {
                         "equip_Wep_Right", "equip_Subwep_Right",
                         "equip_Wep_Left", "equip_Subwep_Left",
                     })
            {
                var id = GetCellInt(row, field);
                if (id >= 0)
                    vanillaStartingWeaponIds.Add(id);
            }
            foreach (var field in new[]
                     {
                         "equip_Helm", "equip_Armer", "equip_Gaunt", "equip_Leg",
                     })
            {
                var id = GetCellInt(row, field);
                if (id >= 0)
                    vanillaStartingArmorIds.Add(id);
            }
        }
    }
    foreach (var rowId in startingLotDefinitions.Values
                 .SelectMany(roles => roles.Values)
                 .Where(id => id.HasValue)
                 .Select(id => id!.Value))
    {
        var row = itemLotParam.Rows.Single(entry => entry.ID == rowId);
        foreach (var cell in row.Cells.Where(cell =>
                     cell.Def.InternalName.StartsWith(
                         "lotItemId", StringComparison.Ordinal)))
        {
            var id = Convert.ToInt32(cell.Value);
            if (id > 0)
                vanillaStartingWeaponIds.Add(id);
        }
    }
    var statFields = new HashSet<string>(StringComparer.Ordinal)
    {
        "soulLv", "baseHp", "baseMp", "baseSp",
        "baseVit", "baseWil", "baseEnd", "baseStr", "baseDex",
        "baseMag", "baseFai", "baseLuc", "baseHeroPoint", "baseDurability",
    };

    foreach (var placement in placements)
    {
        var target = classRows[placement.Slot];
        if (placement.RandomizeStats)
        {
            var source = classSnapshots[placement.StatsFrom];
            CopyCells(source.Display, target.Display, name => statFields.Contains(name));
            CopyCells(source.Start, target.Start, name => statFields.Contains(name));
        }
        if (placement.RandomizeEquipment)
        {
            if (placement.Equipment != null)
            {
                ValidateStartingEquipmentPools(
                    catalog.StartingEquipmentPools,
                    placement.Equipment,
                    vanillaStartingWeaponIds,
                    vanillaStartingArmorIds);
                SetCell(
                    target.Display,
                    "equip_Wep_Right",
                    placement.Equipment.PickupWeapon);
                SetCell(
                    target.Display,
                    "equip_Wep_Left",
                    placement.Equipment.PickupOffhand);
                if (placement.Equipment.PickupSpecial.HasValue)
                {
                    SetCell(
                        target.Display,
                        "equip_Subwep_Right",
                        placement.Equipment.PickupSpecial.Value);
                }
                SetStartingArmor(target.Display, placement.Equipment);
                SetStartingArmor(target.Start, placement.Equipment);
            }
            else
            {
                var source = classSnapshots[placement.EquipmentFrom];
                CopyCells(source.Display, target.Display, IsEquipmentField);
                CopyCells(source.Start, target.Start, IsEquipmentField);
            }
        }
    }
    foreach (var placement in placements)
    {
        var target = classRows[placement.Slot];
        if (placement.RandomizeStats)
        {
            var source = classSnapshots[placement.StatsFrom];
            AssertCells(source.Display, target.Display, name => statFields.Contains(name));
            AssertCells(source.Start, target.Start, name => statFields.Contains(name));
        }
        if (placement.RandomizeEquipment)
        {
            if (placement.Equipment != null)
            {
                var original = classSnapshots[placement.Slot];
                AssertCell(
                    target.Display,
                    "equip_Wep_Right",
                    placement.Equipment.PickupWeapon);
                AssertCell(
                    target.Display,
                    "equip_Wep_Left",
                    placement.Equipment.PickupOffhand);
                if (placement.Equipment.PickupSpecial.HasValue)
                {
                    AssertCell(
                        target.Display,
                        "equip_Subwep_Right",
                        placement.Equipment.PickupSpecial.Value);
                }
                AssertStartingArmor(target.Display, placement.Equipment);
                AssertStartingArmor(target.Start, placement.Equipment);
                AssertCells(
                    original.Display,
                    target.Display,
                    name => IsEquipmentField(name) &&
                        name is not "equip_Wep_Right" and
                            not "equip_Wep_Left" and
                            not "equip_Subwep_Right" &&
                        !IsArmorField(name));
                AssertCells(
                    original.Start,
                    target.Start,
                    name => IsEquipmentField(name) && !IsArmorField(name));
            }
            else
            {
                var source = classSnapshots[placement.EquipmentFrom];
                AssertCells(source.Display, target.Display, IsEquipmentField);
                AssertCells(source.Start, target.Start, IsEquipmentField);
            }
        }
    }

    if (placements.Any(placement => placement.RandomizeEquipment))
    {
        var lotSnapshots = itemLotParam.Rows
            .Where(row => startingLotDefinitions.Values
                .SelectMany(roles => roles.Values)
                .Any(id => id == row.ID))
            .ToDictionary(row => row.ID, RowCells);
        foreach (var placement in placements.Where(entry => entry.RandomizeEquipment))
        {
            foreach (var role in startingLotDefinitions[placement.Slot])
            {
                if (!role.Value.HasValue)
                    continue;
                var targetRow = itemLotParam.Rows.Single(row => row.ID == role.Value.Value);
                if (placement.Equipment != null)
                {
                    var itemId = role.Key switch
                    {
                        "weapon" => placement.Equipment.PickupWeapon,
                        "offhand" => placement.Equipment.PickupOffhand,
                        "special" => placement.Equipment.PickupSpecial
                            ?? throw new InvalidDataException(
                                $"Class {placement.Slot} did not receive a special pickup."),
                        _ => throw new InvalidDataException($"Unknown lot role: {role.Key}"),
                    };
                    var candidate = catalog.StartingEquipmentPools.Weapons
                        .SingleOrDefault(item => item.Id == itemId)
                        ?? throw new InvalidDataException(
                            $"Pickup {itemId} is not in the valid weapon pool.");
                    if (role.Key == "weapon" && !candidate.IsPrimaryWeapon)
                        throw new InvalidDataException(
                            $"The first pickup for class {placement.Slot} is not a primary weapon.");
                    SetCell(targetRow, "lotItemId01", itemId);
                    AssertCell(targetRow, "lotItemId01", itemId);
                }
                else
                {
                    var sourceRowId = startingLotDefinitions[placement.EquipmentFrom][role.Key]
                        ?? throw new InvalidDataException(
                            $"Class {placement.EquipmentFrom} has no {role.Key} lot.");
                    CopyCells(
                        lotSnapshots[sourceRowId],
                        targetRow,
                        name => !name.Contains("FlagId", StringComparison.OrdinalIgnoreCase));
                    AssertCells(
                        lotSnapshots[sourceRowId],
                        targetRow,
                        name => !name.Contains("FlagId", StringComparison.OrdinalIgnoreCase));
                }
            }
        }
    }

    ApplyRowMappings(
        itemLotParam,
        giftPlacements,
        IsItemLotPayloadField,
        "NPC gift");
    ApplyRowMappings(
        itemLotParam,
        enemyDropPlacements,
        IsItemLotPayloadField,
        "drop");
    ApplyRowMappings(
        itemLotParam,
        worldItemPlacements,
        IsItemLotPayloadField,
        "world item");
    ApplyRowMappings(
        shopParam,
        shopPlacements,
        name => name.Equals("equipId", StringComparison.Ordinal),
        "shop");

    charaFile.Bytes = charaParam.Write();
    itemLotFile.Bytes = itemLotParam.Write();
    shopFile.Bytes = shopParam.Write();
    npcFile.Bytes = npcParam.Write();
    var outputRelative = "mod/param/GameParam/GameParam.parambnd.dcx";
    var outputPath = Path.Combine(
        outputDirectory, outputRelative.Replace('/', Path.DirectorySeparatorChar));
    Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
    binder.Write(outputPath);

    // Verify the binder and all three PARAMs that may have changed.
    var verification = BND3.Read(outputPath);
    var verifiedCharaFile = verification.Files.Single(file =>
        file.Name.EndsWith("CharaInitParam.param", StringComparison.OrdinalIgnoreCase));
    var verifiedLotFile = verification.Files.Single(file =>
        file.Name.EndsWith("ItemLotParam.param", StringComparison.OrdinalIgnoreCase));
    var verifiedShopFile = verification.Files.Single(file =>
        file.Name.EndsWith("ShopLineupParam.param", StringComparison.OrdinalIgnoreCase));
    var verifiedNpcFile = verification.Files.Single(file =>
        file.Name.EndsWith("NpcParam.param", StringComparison.OrdinalIgnoreCase));
    var verifiedChara = PARAM.Read(verifiedCharaFile.Bytes);
    var verifiedLots = PARAM.Read(verifiedLotFile.Bytes);
    var verifiedShops = PARAM.Read(verifiedShopFile.Bytes);
    var verifiedNpcs = PARAM.Read(verifiedNpcFile.Bytes);
    ApplyCompatibleParamdef(verifiedNpcs, paramdefs);
    if (verifiedChara.Rows.Count != charaParam.Rows.Count ||
        verifiedLots.Rows.Count != itemLotParam.Rows.Count ||
        verifiedShops.Rows.Count != shopParam.Rows.Count ||
        verifiedNpcs.Rows.Count != npcParam.Rows.Count ||
        !verifiedCharaFile.Bytes.SequenceEqual(charaFile.Bytes) ||
        !verifiedLotFile.Bytes.SequenceEqual(itemLotFile.Bytes) ||
        !verifiedShopFile.Bytes.SequenceEqual(shopFile.Bytes) ||
        !verifiedNpcFile.Bytes.SequenceEqual(npcFile.Bytes))
        throw new InvalidDataException("Invalid GameParam round-trip.");
    foreach (var placement in enemyPlacements.Where(value => value.ScaledNpcParamId.HasValue))
    {
        var scaled = verifiedNpcs.Rows.Single(row => row.ID == placement.ScaledNpcParamId);
        var source = verifiedNpcs.Rows.Single(row => row.ID == placement.SourceNpcParamId);
        var target = verifiedNpcs.Rows.Single(row => row.ID == placement.TargetNpcParamId);
        AssertCell(scaled, "hp", GetCellInt(source, "hp"));
        foreach (var cell in scaled.Cells.Where(cell =>
                     cell.Def.InternalName.StartsWith(
                         "spEffectID", StringComparison.Ordinal)))
        {
            AssertCell(
                scaled,
                cell.Def.InternalName,
                GetCellInt(source, cell.Def.InternalName));
        }
        AssertCell(scaled, "nameId", GetCellInt(target, "nameId"));
    }
    AssertHash(sourcePath, sourceRecord.Sha256, "Source GameParam changed");

    return new PatchedFile(
        relativeSource,
        outputRelative,
        sourceRecord.Sha256,
        HashFile(outputPath));
}

static void AddScaledNpcRows(PARAM npcParam, List<PatchPlacement> placements)
{
    if (placements.Count == 0)
        return;
    var existingIds = npcParam.Rows.Select(row => row.ID).ToHashSet();
    var originalRows = npcParam.Rows.ToDictionary(row => row.ID);
    var combatFields = new HashSet<string>(StringComparer.Ordinal)
    {
        "hp", "mp", "getSoul", "stamina", "staminaRecoverBaseVel",
        "def_phys", "def_slash", "def_blow", "def_thrust",
        "def_mag", "def_fire", "def_thunder", "defFlickPower",
        "resist_poison", "resist_desease", "resist_blood", "resist_curse",
        "physGuardCutRate", "magGuardCutRate", "fireGuardCutRate",
        "thunGuardCutRate", "slashGuardCutRate", "blowGuardCutRate",
        "thrustGuardCutRate",
    };
    foreach (var cell in npcParam.Rows[0].Cells.Where(cell =>
                 cell.Def.InternalName.StartsWith(
                     "spEffectID", StringComparison.Ordinal)))
    {
        // NPC SpEffects can contain hidden HP, defense, and attack multipliers.
        // Keeping them from a late-game replacement can overpower an early slot,
        // so every scaling effect comes from the destination encounter.
        combatFields.Add(cell.Def.InternalName);
    }

    foreach (var placement in placements)
    {
        var newId = placement.ScaledNpcParamId!.Value;
        if (!existingIds.Add(newId))
            throw new InvalidDataException($"Duplicate scaled NpcParam ID: {newId}.");
        if (!originalRows.TryGetValue(placement.TargetNpcParamId, out var target))
            throw new InvalidDataException(
                $"Target NpcParam row not found: {placement.TargetNpcParamId}.");
        if (!originalRows.TryGetValue(placement.SourceNpcParamId, out var source))
            throw new InvalidDataException(
                $"Source NpcParam row not found: {placement.SourceNpcParamId}.");

        var scaled = new PARAM.Row(
            newId,
            $"DSR Randomizer {placement.MapId} {placement.SlotId}",
            npcParam.AppliedParamdef);
        CopyCells(RowCells(target), scaled, _ => true);
        CopyCells(RowCells(source), scaled, name => combatFields.Contains(name));
        AssertCells(RowCells(target), scaled, name => !combatFields.Contains(name));
        AssertCells(RowCells(source), scaled, name => combatFields.Contains(name));
        npcParam.Rows.Add(scaled);
    }
    npcParam.Rows.Sort((left, right) => left.ID.CompareTo(right.ID));
}

static void SetCell(PARAM.Row row, string name, int value)
{
    var cell = row.Cells.Single(entry =>
        entry.Def.InternalName.Equals(name, StringComparison.Ordinal));
    cell.Value = Convert.ChangeType(value, cell.Value.GetType());
}

static bool IsArmorField(string name) =>
    name is "equip_Helm" or "equip_Armer" or "equip_Gaunt" or "equip_Leg";

static void ValidateStartingEquipmentPools(
    StartingEquipmentPools pools,
    RandomStartingEquipment equipment,
    HashSet<int> vanillaWeaponIds,
    HashSet<int> vanillaArmorIds)
{
    static void Require(List<ItemCandidate> pool, int id, string slot)
    {
        if (!pool.Any(item => item.Id == id))
            throw new InvalidDataException(
                $"Item {id} is not in the valid {slot} pool.");
    }
    Require(pools.Helms, equipment.Helm, "helmet");
    Require(pools.Armors, equipment.Armor, "chest armor");
    Require(pools.Gauntlets, equipment.Gauntlets, "gauntlets");
    Require(pools.Legs, equipment.Legs, "leg armor");
    foreach (var id in new[]
             {
                 equipment.PickupWeapon,
                 equipment.PickupOffhand,
                 equipment.PickupSpecial ?? -1,
             })
    {
        if (id > 0 && id % 1_000 != 0)
            throw new InvalidDataException(
                $"Reinforced weapon {id} cannot be used as a starting pickup.");
        if (vanillaWeaponIds.Contains(id))
            throw new InvalidDataException(
                $"Vanilla starting weapon {id} appeared in the randomized pool.");
    }
    foreach (var id in new[]
             {
                 equipment.Helm,
                 equipment.Armor,
                 equipment.Gauntlets,
                 equipment.Legs,
             })
    {
        if (vanillaArmorIds.Contains(id))
            throw new InvalidDataException(
                $"Vanilla starting armor {id} appeared in the randomized pool.");
    }
}

static void SetStartingArmor(
    PARAM.Row row,
    RandomStartingEquipment equipment)
{
    SetCell(row, "equip_Helm", equipment.Helm);
    SetCell(row, "equip_Armer", equipment.Armor);
    SetCell(row, "equip_Gaunt", equipment.Gauntlets);
    SetCell(row, "equip_Leg", equipment.Legs);
}

static void AssertStartingArmor(
    PARAM.Row row,
    RandomStartingEquipment equipment)
{
    AssertCell(row, "equip_Helm", equipment.Helm);
    AssertCell(row, "equip_Armer", equipment.Armor);
    AssertCell(row, "equip_Gaunt", equipment.Gauntlets);
    AssertCell(row, "equip_Leg", equipment.Legs);
}

static void AssertCell(PARAM.Row row, string name, int expected)
{
    var actual = GetCellInt(row, name);
    if (actual != expected)
        throw new InvalidDataException(
            $"Validation failed for {row.ID}:{name}; expected {expected}, got {actual}.");
}

static bool IsEquipmentField(string name) =>
    name.StartsWith("equip_", StringComparison.Ordinal) ||
    name.StartsWith("item_", StringComparison.Ordinal) ||
    name.StartsWith("itemNum_", StringComparison.Ordinal) ||
    name is "arrowNum" or "boltNum" or "subArrowNum" or "subBoltNum";

static bool IsItemLotPayloadField(string name) =>
    !name.Contains("FlagId", StringComparison.OrdinalIgnoreCase) &&
    (name.StartsWith("lotItem", StringComparison.Ordinal) ||
     name.StartsWith("cumulateLotPoint", StringComparison.Ordinal));

static int GetCellInt(PARAM.Row row, string name, int fallback = -1)
{
    var cell = row.Cells.SingleOrDefault(entry =>
        entry.Def.InternalName.Equals(name, StringComparison.OrdinalIgnoreCase));
    return cell == null ? fallback : Convert.ToInt32(cell.Value);
}

static float GetCellFloat(PARAM.Row row, string name, float fallback = -1)
{
    var cell = row.Cells.SingleOrDefault(entry =>
        entry.Def.InternalName.Equals(name, StringComparison.OrdinalIgnoreCase));
    return cell == null ? fallback : Convert.ToSingle(cell.Value);
}

static void ApplyRowMappings(
    PARAM param,
    List<RowPlacement> placements,
    Func<string, bool> include,
    string category)
{
    if (placements.Count == 0)
        return;
    var relevantIds = placements
        .SelectMany(placement => new[] { placement.RowId, placement.SourceRowId })
        .ToHashSet();
    var rows = param.Rows
        .Where(row => relevantIds.Contains(row.ID))
        .ToDictionary(row => row.ID);
    if (rows.Count != relevantIds.Count)
        throw new InvalidDataException($"Rows are missing from the {category} category.");
    var snapshots = rows.ToDictionary(pair => pair.Key, pair => RowCells(pair.Value));
    foreach (var placement in placements)
        CopyCells(snapshots[placement.SourceRowId], rows[placement.RowId], include);
    foreach (var placement in placements)
        AssertCells(snapshots[placement.SourceRowId], rows[placement.RowId], include);
}

static void CopyCells(
    IReadOnlyDictionary<string, object> source,
    PARAM.Row target,
    Func<string, bool> include)
{
    foreach (var targetCell in target.Cells)
    {
        var name = targetCell.Def.InternalName;
        if (include(name))
            targetCell.Value = source[name];
    }
}

static void AssertCells(
    IReadOnlyDictionary<string, object> expected,
    PARAM.Row actual,
    Func<string, bool> include)
{
    foreach (var cell in actual.Cells.Where(cell => include(cell.Def.InternalName)))
    {
        var expectedValue = expected[cell.Def.InternalName];
        if (!Equals(cell.Value, expectedValue))
            throw new InvalidDataException(
                $"Validation failed for {actual.ID}:{cell.Def.InternalName}.");
    }
}

static ActivationReport InstallPackage(
    string gameDirectory,
    string packageDirectory,
    JsonSerializerOptions jsonOptions)
{
    EnsureGameClosed();
    var patchManifestPath = Path.Combine(packageDirectory, "patch-manifest.json");
    if (!File.Exists(patchManifestPath))
        throw new FileNotFoundException("Patch manifest not found.", patchManifestPath);

    var patchReport = JsonSerializer.Deserialize<PatchReport>(
        File.ReadAllText(patchManifestPath), jsonOptions)
        ?? throw new InvalidDataException("Invalid patch manifest.");
    var patchFiles = GetPatchFiles(patchReport);
    if (patchFiles.Count == 0)
        throw new InvalidOperationException("The package contains no changed files.");

    var activationPath = Path.Combine(packageDirectory, "activation-manifest.json");
    if (File.Exists(activationPath))
    {
        var previous = JsonSerializer.Deserialize<ActivationReport>(
            File.ReadAllText(activationPath), jsonOptions);
        if (previous?.Active == true)
            throw new InvalidOperationException(
                "This package is already active. Restore it before installing it again.");
    }

    var backupRoot = Path.Combine(packageDirectory, "backup");
    Directory.CreateDirectory(backupRoot);

    // Validate everything before the first write.
    foreach (var file in patchFiles)
    {
        var sourcePath = ResolveGamePath(gameDirectory, file.Source);
        var patchPath = ResolvePackagePath(packageDirectory, file.Output);
        if (!File.Exists(sourcePath))
            throw new FileNotFoundException("Game file not found.", sourcePath);
        if (!File.Exists(patchPath))
            throw new FileNotFoundException("Package file not found.", patchPath);
        AssertHash(sourcePath, file.SourceSha256, $"{file.Source} is not vanilla");
        AssertHash(patchPath, file.OutputSha256, $"Patch {file.Source} is corrupted");
    }

    var installed = new List<ActivationFile>();
    try
    {
        foreach (var file in patchFiles)
        {
            var sourcePath = ResolveGamePath(gameDirectory, file.Source);
            var patchPath = ResolvePackagePath(packageDirectory, file.Output);
            var backupPath = Path.Combine(
                backupRoot, file.Source.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(backupPath)!);
            if (File.Exists(backupPath))
                AssertHash(backupPath, file.SourceSha256, $"Invalid backup for {file.Source}");
            else
                File.Copy(sourcePath, backupPath, false);

            AtomicCopy(patchPath, sourcePath);
            AssertHash(sourcePath, file.OutputSha256, $"Failed to install {file.Source}");
            installed.Add(new ActivationFile(
                file.Source,
                Path.GetRelativePath(packageDirectory, backupPath).Replace('\\', '/'),
                file.SourceSha256,
                file.OutputSha256));
        }
    }
    catch
    {
        foreach (var file in installed)
        {
            var sourcePath = ResolveGamePath(gameDirectory, file.RelativePath);
            var backupPath = ResolvePackagePath(packageDirectory, file.Backup);
            AtomicCopy(backupPath, sourcePath);
        }
        throw;
    }

    var report = new ActivationReport(
        1,
        true,
        DateTimeOffset.UtcNow,
        null,
        installed);
    File.WriteAllText(
        activationPath,
        JsonSerializer.Serialize(report, jsonOptions) + Environment.NewLine);
    return report;
}

static ActivationReport RestorePackage(
    string gameDirectory,
    string packageDirectory,
    JsonSerializerOptions jsonOptions)
{
    EnsureGameClosed();
    var activationPath = Path.Combine(packageDirectory, "activation-manifest.json");
    if (!File.Exists(activationPath))
        throw new FileNotFoundException("Activation manifest not found.", activationPath);
    var activation = JsonSerializer.Deserialize<ActivationReport>(
        File.ReadAllText(activationPath), jsonOptions)
        ?? throw new InvalidDataException("Invalid activation manifest.");
    if (!activation.Active)
        throw new InvalidOperationException("This package is already inactive.");

    // Never restore over files changed by another tool after installation.
    foreach (var file in activation.Files)
    {
        var installedPath = ResolveGamePath(gameDirectory, file.RelativePath);
        var backupPath = ResolvePackagePath(packageDirectory, file.Backup);
        AssertHash(installedPath, file.PatchSha256, $"Active file {file.RelativePath} changed");
        AssertHash(backupPath, file.SourceSha256, $"Backup {file.RelativePath} is corrupted");
    }
    foreach (var file in activation.Files)
    {
        var installedPath = ResolveGamePath(gameDirectory, file.RelativePath);
        var backupPath = ResolvePackagePath(packageDirectory, file.Backup);
        AtomicCopy(backupPath, installedPath);
        AssertHash(installedPath, file.SourceSha256, $"Failed to restore {file.RelativePath}");
    }

    var restored = activation with
    {
        Active = false,
        RestoredAt = DateTimeOffset.UtcNow,
    };
    File.WriteAllText(
        activationPath,
        JsonSerializer.Serialize(restored, jsonOptions) + Environment.NewLine);
    return restored;
}

static void EnsureGameClosed()
{
    if (Process.GetProcessesByName("DarkSoulsRemastered").Length > 0)
        throw new InvalidOperationException(
            "Close Dark Souls Remastered before installing or restoring the mod.");
}

static List<PatchedFile> GetPatchFiles(PatchReport report)
{
    var files = report.PatchedMaps.Select(map => new PatchedFile(
        map.Source, map.Output, map.SourceSha256, map.OutputSha256)).ToList();
    files.AddRange(report.LuaBundles ?? new List<PatchedFile>());
    files.AddRange(report.Events ?? new List<PatchedFile>());
    if (report.FfxBundle != null)
        files.Add(report.FfxBundle);
    if (report.GameParam != null)
        files.Add(report.GameParam);
    return files;
}

static string ResolveGamePath(string gameDirectory, string relativePath)
{
    var resolved = Path.GetFullPath(Path.Combine(
        gameDirectory, relativePath.Replace('/', Path.DirectorySeparatorChar)));
    var relative = Path.GetRelativePath(gameDirectory, resolved);
    if (relative.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relative))
        throw new InvalidDataException("A path outside the game installation was detected.");
    return resolved;
}

static string ResolvePackagePath(string packageDirectory, string relativePath)
{
    var resolved = Path.GetFullPath(Path.Combine(
        packageDirectory,
        relativePath.Replace('/', Path.DirectorySeparatorChar)));
    var relative = Path.GetRelativePath(packageDirectory, resolved);
    if (relative.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relative))
        throw new InvalidDataException("A path outside the package was detected.");
    return resolved;
}

static void AssertHash(string filePath, string expected, string message)
{
    if (!File.Exists(filePath) ||
        !HashFile(filePath).Equals(expected, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException($"{message}: {filePath}");
}

static void AtomicCopy(string sourcePath, string destinationPath)
{
    var temporaryPath = destinationPath + ".dsr-randomizer.tmp";
    File.Copy(sourcePath, temporaryPath, true);
    File.Move(temporaryPath, destinationPath, true);
}

static EnemyPartSnapshot SnapshotEnemy(MSB1.Part.EnemyBase enemy) => new(
    enemy.ModelName,
    enemy.NPCParamID,
    enemy.ThinkParamID,
    enemy.TalkID,
    enemy.CharaInitID,
    enemy.CollisionName,
    enemy.Position.X,
    enemy.Position.Y,
    enemy.Position.Z,
    enemy.Rotation.X,
    enemy.Rotation.Y,
    enemy.Rotation.Z,
    enemy.Scale.X,
    enemy.Scale.Y,
    enemy.Scale.Z,
    enemy.EntityID,
    string.Join("\u001f", enemy.MovePointNames),
    enemy.InitAnimID,
    enemy.DamageAnimID,
    enemy.PointMoveType,
    enemy.PlatoonID);

static void AssertSpawnUnchanged(
    EnemyPartSnapshot original,
    MSB1.Part.EnemyBase verified,
    string mapId,
    float? expectedY = null)
{
    if (verified.Position.X != original.PositionX ||
        verified.Position.Y != (expectedY ?? original.PositionY) ||
        verified.Position.Z != original.PositionZ ||
        verified.Rotation.X != original.RotationX ||
        verified.Rotation.Y != original.RotationY ||
        verified.Rotation.Z != original.RotationZ ||
        verified.Scale.X != original.ScaleX ||
        verified.Scale.Y != original.ScaleY ||
        verified.Scale.Z != original.ScaleZ ||
        verified.EntityID != original.EntityId ||
        verified.TalkID != original.TalkId ||
        verified.CharaInitID != original.CharaInitId ||
        verified.CollisionName != original.CollisionName ||
        string.Join("\u001f", verified.MovePointNames) != original.MovePoints ||
        verified.PointMoveType != original.PointMoveType ||
        verified.PlatoonID != original.PlatoonId)
    {
        throw new InvalidDataException(
            $"Spawn metadata changed unexpectedly in {mapId}: {verified.Name}.");
    }
}

static HashSet<int> ReadEventModelLockedEntities(string eventPath)
{
    var result = new HashSet<int>();
    var emevd = EMEVD.Read(eventPath);
    foreach (var instruction in emevd.Events.SelectMany(entry => entry.Instructions))
    {
        var modelSpecific =
            (instruction.Bank == 2003 && instruction.ID == 18) ||
            (instruction.Bank == 2004 && instruction.ID is 9 or 17 or 41);
        if (!modelSpecific || instruction.ArgData.Length < 4)
            continue;
        var entityId = BitConverter.ToInt32(instruction.ArgData, 0);
        if (entityId >= 0)
            result.Add(entityId);
    }
    return result;
}

static EnemySlotRecord ToSlot(
    string mapId,
    MSB1.Part.EnemyBase enemy,
    bool dummy,
    EnemyMetadataLookup metadata,
    HashSet<int> eventModelLockedEntities)
{
    metadata.Npcs.TryGetValue(enemy.NPCParamID, out var npc);
    metadata.Thinks.TryGetValue(enemy.ThinkParamID, out var think);
    var movePoints = enemy.MovePointNames
        .Where(name => !string.IsNullOrWhiteSpace(name))
        .ToArray();
    var riskFlags = new List<string>();
    if (dummy) riskFlags.Add("dummy");
    if (enemy.EntityID >= 0) riskFlags.Add("entity-id");
    var eventModelLocked = eventModelLockedEntities.Contains(enemy.EntityID);
    if (eventModelLocked) riskFlags.Add("model-specific-event");
    if (enemy.TalkID > 0) riskFlags.Add("talk");
    if (enemy.CharaInitID >= 0) riskFlags.Add("character-init");
    if (movePoints.Length > 0) riskFlags.Add("patrol");
    if (npc == null) riskFlags.Add("missing-npc-param");
    if (think == null) riskFlags.Add("missing-think-param");
    if (npc?.TeamType >= 2) riskFlags.Add("friendly-or-neutral");
    if (enemy.ModelName == "c0000") riskFlags.Add("human-npc");
    var safeCandidate =
        !dummy &&
        enemy.TalkID <= 0 &&
        enemy.CharaInitID < 0 &&
        movePoints.Length == 0 &&
        enemy.ModelName != "c0000" &&
        enemy.NPCParamID >= 0 &&
        enemy.ThinkParamID >= 0 &&
        npc?.TeamType == 0 &&
        think != null &&
        enemy.ModelName.StartsWith('c');

    return new EnemySlotRecord(
        $"{mapId}:{enemy.Name}",
        mapId,
        enemy.Name,
        enemy.ModelName,
        enemy.EntityID,
        enemy.NPCParamID,
        enemy.ThinkParamID,
        enemy.TalkID,
        enemy.CharaInitID,
        enemy.CollisionName,
        new VectorRecord(enemy.Position.X, enemy.Position.Y, enemy.Position.Z),
        new VectorRecord(enemy.Rotation.X, enemy.Rotation.Y, enemy.Rotation.Z),
        movePoints,
        dummy,
        enemy.EntityID >= 0,
        eventModelLocked,
        riskFlags.ToArray(),
        safeCandidate,
        npc?.TeamType ?? -1,
        npc?.NpcType ?? -1,
        npc?.MoveType ?? -1,
        npc?.HitHeight ?? -1,
        npc?.HitRadius ?? -1,
        npc?.HitYOffset ?? 0,
        npc?.BaseHp ?? -1,
        npc?.SoulReward ?? -1,
        think?.BattleStartDistance ?? -1,
        think?.EyeDistance ?? -1,
        think?.EarDistance ?? -1,
        think?.DisablePathMove ?? false,
        think?.BattleGoalId ?? -1);
}

static SourceFile DescribeSource(string filePath, string root)
{
    var info = new FileInfo(filePath);
    using var stream = File.OpenRead(filePath);
    var hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    return new SourceFile(
        Path.GetRelativePath(root, filePath).Replace('\\', '/'),
        info.Length,
        info.LastWriteTimeUtc,
        hash);
}

static string HashFile(string filePath)
{
    using var stream = File.OpenRead(filePath);
    return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
}

static Dictionary<string, string> CreateMapNames() => new()
{
    ["m10_00_00_00"] = "Depths",
    ["m10_01_00_00"] = "Undead Burg / Undead Parish",
    ["m10_02_00_00"] = "Firelink Shrine",
    ["m11_00_00_00"] = "Painted World of Ariamis",
    ["m12_00_00_00"] = "Darkroot Garden / Darkroot Basin",
    ["m12_00_00_01"] = "Darkroot Garden / Darkroot Basin",
    ["m12_01_00_00"] = "Oolacile / Royal Wood",
    ["m13_00_00_00"] = "The Catacombs",
    ["m13_01_00_00"] = "Tomb of the Giants",
    ["m13_02_00_00"] = "Great Hollow / Ash Lake",
    ["m14_00_00_00"] = "Blighttown / Quelaag's Domain",
    ["m14_01_00_00"] = "Demon Ruins / Lost Izalith",
    ["m15_00_00_00"] = "Sen's Fortress",
    ["m15_01_00_00"] = "Anor Londo",
    ["m16_00_00_00"] = "New Londo Ruins / Valley of Drakes",
    ["m17_00_00_00"] = "The Duke's Archives / Crystal Cave",
    ["m18_00_00_00"] = "Kiln of the First Flame",
    ["m18_01_00_00"] = "Undead Asylum",
};

record GameCatalog(
    int SchemaVersion,
    DateTimeOffset GeneratedAt,
    string Game,
    string Mode,
    List<SourceFile> SourceFiles,
    List<MapRecord> Maps,
    List<EnemySlotRecord> EnemySlots,
    List<EnemyArchetypeRecord> EnemyArchetypes,
    List<EnemySlotRecord> BossSlots,
    List<BinderEntryRecord> GameParamEntries,
    List<StartingClassRecord> StartingClasses,
    List<StartingItemLotRecord> StartingItemLots,
    List<ParamRowRecord> Gifts,
    List<ParamRowRecord> EnemyDropLots,
    List<WorldItemLotRecord> WorldItemLots,
    List<ShopEntryRecord> ShopEntries,
    StartingEquipmentPools StartingEquipmentPools,
    Dictionary<string, string> BossNames,
    List<int> AiGoalIds,
    List<ScanError> Errors,
    List<string> IgnoredFiles);

record SourceFile(string Path, long Size, DateTime LastWriteTimeUtc, string Sha256);
record LuaBundleSource(
    SourceFile Record,
    BND3 Binder,
    LUAINFO Info,
    LUAGNL Globals);
record LuaAiEntry(
    List<BinderFile> Scripts,
    List<LUAINFO.Goal> Goals,
    List<string> Globals);
record MapRecord(string Id, string Name, int Enemies, int DummyEnemies);
record VectorRecord(float X, float Y, float Z);

record EnemySlotRecord(
    string Id,
    string MapId,
    string Name,
    string ModelName,
    int EntityId,
    int NpcParamId,
    int ThinkParamId,
    int TalkId,
    int CharaInitId,
    string? CollisionName,
    VectorRecord Position,
    VectorRecord Rotation,
    string[] MovePoints,
    bool Dummy,
    bool HasEntityId,
    bool EventModelLocked,
    string[] RiskFlags,
    bool SafeCandidate,
    int TeamType,
    int NpcType,
    int MoveType,
    float HitHeight,
    float HitRadius,
    float HitYOffset,
    int BaseHp,
    int SoulReward,
    float BattleStartDistance,
    float EyeDistance,
    float EarDistance,
    bool DisablePathMove,
    int BattleGoalId);

record EnemyArchetypeRecord(
    string Id,
    string ModelName,
    int NpcParamId,
    int ThinkParamId,
    int CharaInitId,
    int TeamType,
    int NpcType,
    int MoveType,
    float HitHeight,
    float HitRadius,
    int BaseHp,
    int SoulReward,
    float BattleStartDistance,
    float EyeDistance,
    float EarDistance,
    bool DisablePathMove,
    int BattleGoalId,
    int SlotCount,
    string[] Maps,
    int SafeSlotCount);
record NpcMetadata(
    int TeamType,
    int NpcType,
    int MoveType,
    float HitHeight,
    float HitRadius,
    float HitYOffset,
    int BaseHp,
    int SoulReward);
record ThinkMetadata(
    float BattleStartDistance,
    float EyeDistance,
    float EarDistance,
    bool DisablePathMove,
    int BattleGoalId);
record EnemyMetadataLookup(
    Dictionary<int, NpcMetadata> Npcs,
    Dictionary<int, ThinkMetadata> Thinks);
record EnemyPartSnapshot(
    string ModelName,
    int NpcParamId,
    int ThinkParamId,
    int TalkId,
    int CharaInitId,
    string? CollisionName,
    float PositionX,
    float PositionY,
    float PositionZ,
    float RotationX,
    float RotationY,
    float RotationZ,
    float ScaleX,
    float ScaleY,
    float ScaleZ,
    int EntityId,
    string MovePoints,
    int InitAnimId,
    int DamageAnimId,
    byte PointMoveType,
    ushort PlatoonId);

record BinderEntryRecord(int Id, string Name, int Size, string Sha256);
record StartingClassRecord(
    string Id,
    string Name,
    int DisplayRowId,
    int StartRowId,
    Dictionary<string, object> Display,
    Dictionary<string, object> Start);
record StartingItemLotRecord(
    string ClassId,
    string Role,
    int RowId,
    Dictionary<string, object> Cells);
record StartingData(
    List<StartingClassRecord> Classes,
    List<StartingItemLotRecord> ItemLots);
record ParamRowRecord(int RowId, string Name);
record ItemLotEntryRecord(int ItemId, int Category, int Quantity);
record ItemNameLookup(
    Dictionary<int, string> Goods,
    Dictionary<int, string> Weapons,
    Dictionary<int, string> Armor,
    Dictionary<int, string> Accessories,
    Dictionary<int, string> Magic)
{
    public string GetName(int category, int itemId)
    {
        var names = category switch
        {
            0 => Weapons,
            0x10000000 => Armor,
            0x20000000 => Accessories,
            0x40000000 => Goods,
            _ => null,
        };
        return names?.GetValueOrDefault(itemId)
            ?? $"Unknown item (category {category}, ID {itemId})";
    }

    public string GetShopName(int equipType, int itemId)
    {
        var names = equipType switch
        {
            0 => Weapons,
            1 => Armor,
            2 => Accessories,
            3 => Goods,
            4 => Magic,
            _ => null,
        };
        return names?.GetValueOrDefault(itemId)
            ?? $"Shop item (type {equipType}, ID {itemId})";
    }
}
record WorldItemLotRecord(
    int RowId,
    string Name,
    string MapId,
    bool ProtectedProgression,
    List<ItemLotEntryRecord> Entries);
record ShopEntryRecord(
    int RowId,
    string Name,
    int EquipId,
    int EquipType,
    int EventFlag);
record ItemCandidate(
    int Id,
    string Name,
    int Strength = 0,
    int Dexterity = 0,
    int Intelligence = 0,
    int Faith = 0,
    bool IsPrimaryWeapon = false);
record StartingEquipmentPools(
    List<ItemCandidate> Weapons,
    List<ItemCandidate> Helms,
    List<ItemCandidate> Armors,
    List<ItemCandidate> Gauntlets,
    List<ItemCandidate> Legs);
record RandomizerParamData(
    List<ParamRowRecord> Gifts,
    List<ParamRowRecord> EnemyDropLots,
    List<WorldItemLotRecord> WorldItemLots,
    List<ShopEntryRecord> ShopEntries,
    StartingEquipmentPools StartingEquipmentPools);
record ScanError(string Path, string Stage, string Message);
record PatchPlacement(
    string SlotId,
    string MapId,
    string TargetModelName,
    int TargetNpcParamId,
    int TargetThinkParamId,
    int TargetBattleGoalId,
    int SourceNpcParamId,
    int? ScaledNpcParamId,
    int EntityId,
    float? GroundY,
    bool LinkedEnemyGroup)
{
    public int EffectiveNpcParamId => ScaledNpcParamId ?? TargetNpcParamId;
}
record StartingPlacement(
    string Slot,
    string StatsFrom,
    string EquipmentFrom,
    bool RandomizeStats,
    bool RandomizeEquipment,
    RandomStartingEquipment? Equipment);
record RandomStartingEquipment(
    int PickupWeapon,
    int PickupOffhand,
    int? PickupSpecial,
    int Helm,
    int Armor,
    int Gauntlets,
    int Legs);
record RowPlacement(int RowId, int SourceRowId);
record PatchedMap(
    string MapId,
    string Source,
    string Output,
    int ChangedSlots,
    string SourceSha256,
    string OutputSha256);
record PatchedFile(
    string Source,
    string Output,
    string SourceSha256,
    string OutputSha256);
record PatchReport(
    int SchemaVersion,
    DateTimeOffset GeneratedAt,
    string OutputDirectory,
    int ChangedSlots,
    List<PatchedMap> PatchedMaps,
    List<PatchedFile> LuaBundles,
    List<PatchedFile> Events,
    PatchedFile? FfxBundle,
    PatchedFile? GameParam);
record ActivationFile(
    string RelativePath,
    string Backup,
    string SourceSha256,
    string PatchSha256);
record ActivationReport(
    int SchemaVersion,
    bool Active,
    DateTimeOffset InstalledAt,
    DateTimeOffset? RestoredAt,
    List<ActivationFile> Files);
