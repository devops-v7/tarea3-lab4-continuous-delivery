import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as codebuild from "aws-cdk-lib/aws-codebuild";


export class PipelineCdkStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // Recupera el token de GitHub desde Secrets Manager
    const githubSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GitHubSecret",
      "github/personal_access_token2"
    );

    // Define el pipeline
    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: "CICD_Pipeline",
      crossAccountKeys: false,
    });

    // Define el proyecto de CodeBuild
    const codeBuild = new codebuild.PipelineProject( this, 'CodeBuild', {
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          privileged: true,
          computeType: codebuild.ComputeType.LARGE,
        },
        buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec_test.yml'),
      }
    );

    // Define los artefactos de salida
    const sourceOutput = new codepipeline.Artifact();
    const unitTestOutput = new codepipeline.Artifact();
    //const buildOutput = new codepipeline.Artifact();

    // Agrega la etapa de origen con GitHub
    pipeline.addStage({
      stageName: "Source",
      actions: [
        new codepipeline_actions.GitHubSourceAction({
          actionName: "GitHub_Source",
          owner: "devops-v7", // Nombre de la organización en GitHub
          repo: "tarea3-lab4-continuous-delivery", // Nombre del repositorio
          branch: "main", // Rama principal del repositorio
          oauthToken: githubSecret.secretValue, // Token de acceso de GitHub
          output: sourceOutput,
        }),
      ],
    });

    // Agrega la etapa de construcción y pruebas
    pipeline.addStage({
      stageName: "Code-Quality-Testing",
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: "Unit-Test",
          project: codeBuild,
          input: sourceOutput,
          outputs: [unitTestOutput],
        }),
      ],
    });



  

    // Salida de la URL del repositorio
    new CfnOutput(this, "RepositoryUrl", {
      value: "https://github.com/devops-v7/tarea3-lab4-continuous-delivery",
    });
  }
}
