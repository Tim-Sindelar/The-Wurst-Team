plugins {
    id("com.android.application")
}

android {
    namespace = "ch.ethz.polymapsar"
    compileSdk = 36
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "ch.ethz.polymapsar"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.2.0"
        // The page the app opens. Override with -PappUrl=https://... (e.g. a dev server).
        val appUrl = (project.findProperty("appUrl") as String?) ?: "https://02.hackathon.ethz.ch/ar/"
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
        // onnxruntime ships native code for every ABI (~30 MB each): phones are arm64.
        ndk { abiFilters += "arm64-v8a" }
    }

    buildFeatures {
        buildConfig = true
    }

    // The page's SuperPoint model (public/vps/superpoint.onnx) as an asset for NativeSuperPoint.
    sourceSets["main"].assets.directories.add(layout.buildDirectory.dir("generated/vpsAssets").get().asFile.path)

    androidResources {
        noCompress += "onnx"
    }

    // Compressed native libraries: onnxruntime is 34 MB raw, the APK is downloaded through the
    // hackathon's login proxy (unpacked to disk once on install).
    packaging {
        jniLibs { useLegacyPackaging = true }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

val copyVpsModel by tasks.registering(Copy::class) {
    from(rootProject.file("../public/vps/superpoint.onnx"))
    into(layout.buildDirectory.dir("generated/vpsAssets"))
}
tasks.named("preBuild") { dependsOn(copyVpsModel) }

dependencies {
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.31.0")
}
