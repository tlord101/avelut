import fs from "fs";
import AdmZip from "adm-zip";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

async function deployOTA() {
    try {
        const supabaseUrl = process.env.SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5d3Brc2FwenR6Ym50aGxnZmhkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODAyNzkzNiwiZXhwIjoyMTAzNjAzOTM2fQ.nFcGWEvj9H0MTlksKR48ldaK3_q9yGsZkeo6WMsuZZ4';

        console.log(`[OTA] Connecting to Supabase: ${supabaseUrl}`);
        const supabase = createClient(supabaseUrl, supabaseKey);

        console.log("[OTA] Building web project bundle...");
        const npmCmd = process.platform === "win32" ? "npm.cmd run build" : "npm run build";
        try {
            execSync(npmCmd, { stdio: "inherit" });
        } catch (err) {
            console.log("[OTA] Web build finished (react-snap postbuild handled). Checking for dist...");
            if (!fs.existsSync("./dist")) {
                throw err;
            }
        }

        const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
        const baseVersion = pkg.version || "5.9.2";
        const otaVersion = `${baseVersion}-${Date.now()}`;
        console.log(`[OTA] Generated OTA Version: ${otaVersion}`);

        // Write version.json into dist for app sync
        const versionJsonPath = "./dist/version.json";
        const versionPayload = {
            version: otaVersion,
            baseVersion,
            buildTimestamp: Date.now(),
        };
        fs.writeFileSync(versionJsonPath, JSON.stringify(versionPayload, null, 2));
        console.log("[OTA] Written version.json to dist");

        console.log("[OTA] Creating dist.zip package...");
        const zip = new AdmZip();
        zip.addLocalFolder("./dist");
        zip.writeZip("./dist.zip");

        console.log("[OTA] Verifying 'ota-releases' bucket...");
        try {
            const { data: buckets } = await supabase.storage.listBuckets();
            const bucketExists = buckets?.some(b => b.name === 'ota-releases');
            if (!bucketExists && buckets && buckets.length > 0) {
                console.log("[OTA] Creating 'ota-releases' bucket...");
                await supabase.storage.createBucket('ota-releases', { public: true });
            }
        } catch {
            // Bucket likely already exists
        }

        console.log("[OTA] Uploading package to Supabase Storage: ota-releases/app_releases/ota/...");
        const zipBuffer = fs.readFileSync("./dist.zip");
        const objectPath = `app_releases/ota/${otaVersion}.zip`;

        const { error: uploadError } = await supabase.storage
            .from('ota-releases')
            .upload(objectPath, zipBuffer, {
                contentType: 'application/zip',
                upsert: true
            });

        if (uploadError) {
            throw new Error(`Failed to upload to Supabase Storage: ${uploadError.message}`);
        }
        console.log("[OTA] Upload complete!");

        const { data: publicUrlData } = supabase.storage
            .from('ota-releases')
            .getPublicUrl(objectPath);

        const downloadUrl = publicUrlData.publicUrl;
        console.log("[OTA] Public Download URL:", downloadUrl);

        console.log("[OTA] Updating app_kv at 'app_updates/ota_latest'...");
        const { error: dbError } = await supabase
            .from('app_kv')
            .upsert({
                key: 'app_updates/ota_latest',
                value: {
                    version: otaVersion,
                    downloadUrl: downloadUrl,
                    releaseDate: new Date().toISOString()
                }
            }, { onConflict: 'key' });

        if (dbError) {
             throw new Error(`Failed to update app_kv: ${dbError.message}`);
        }

        console.log(`\n🎉 [OTA] SUCCESSFULLY DEPLOYED TO SUPABASE!`);
        console.log(`   OTA Version: ${otaVersion}`);
        console.log(`   Download:    ${downloadUrl}`);
        
        // Cleanup dist.zip
        if (fs.existsSync("./dist.zip")) {
            fs.unlinkSync("./dist.zip");
        }
        process.exit(0);
    } catch (e) {
        console.error("\n❌ [OTA] Deployment failed:", e);
        if (fs.existsSync("./dist.zip")) {
            fs.unlinkSync("./dist.zip");
        }
        process.exit(1);
    }
}

deployOTA();
