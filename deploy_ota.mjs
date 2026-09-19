import fs from "fs";
import AdmZip from "adm-zip";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

async function deployOTA() {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
            process.exit(1);
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        console.log("Building web project...");
        try {
            execSync("npm run build", { stdio: "inherit" });
        } catch (err) {
            console.log("npm run build returned non-zero, likely due to react-snap postbuild. Checking for dist...");
            if (!fs.existsSync("./dist")) {
                throw err;
            }
        }

        const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
        const baseVersion = pkg.version;
        const otaVersion = `${baseVersion}-${Date.now()}`;
        console.log(`Generated OTA Version: ${otaVersion}`);

        console.log("Zipping dist directory...");
        const zip = new AdmZip();
        zip.addLocalFolder("./dist");
        zip.writeZip("./dist.zip");

        console.log("Ensuring 'ota-releases' bucket exists...");
        const { data: buckets } = await supabase.storage.listBuckets();
        const bucketExists = buckets?.some(b => b.name === 'ota-releases');
        if (!bucketExists) {
            console.log("Bucket not found. Creating 'ota-releases' bucket...");
            await supabase.storage.createBucket('ota-releases', { public: true });
        }

        console.log("Uploading OTA package to Supabase Storage...");
        const zipBuffer = fs.readFileSync("./dist.zip");
        const objectPath = `app_releases/ota/${otaVersion}.zip`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('ota-releases')
            .upload(objectPath, zipBuffer, {
                contentType: 'application/zip',
                upsert: true
            });

        if (uploadError) {
            throw new Error(`Failed to upload to Supabase Storage: ${uploadError.message}`);
        }
        console.log("Upload complete.");

        const { data: publicUrlData } = supabase.storage
            .from('ota-releases')
            .getPublicUrl(objectPath);

        const downloadUrl = publicUrlData.publicUrl;
        console.log("Download URL:", downloadUrl);

        console.log("Updating app_kv at app_updates/ota_latest...");
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

        console.log("✅ OTA Database updated successfully to version:", otaVersion);
        
        // Cleanup
        if (fs.existsSync("./dist.zip")) {
            fs.unlinkSync("./dist.zip");
        }
        process.exit(0);
    } catch (e) {
        console.error("Error during OTA deployment:", e);
        if (fs.existsSync("./dist.zip")) {
            fs.unlinkSync("./dist.zip");
        }
        process.exit(1);
    }
}

deployOTA();
