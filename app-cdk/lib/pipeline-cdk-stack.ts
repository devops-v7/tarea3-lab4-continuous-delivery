import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

interface ConsumerProps extends StackProps {
  ecrRepository: ecr.Repository;
  fargateServiceTest: ecsPatterns.ApplicationLoadBalancedFargateService;
  greenTargetGroup: elbv2.ApplicationTargetGroup;
  greenLoadBalancerListener: elbv2.ApplicationListener;
  fargateServiceProd: ecsPatterns.ApplicationLoadBalancedFargateService;
}

export class PipelineCdkStack extends Stack {
  constructor(scope: Construct, id: string, props: ConsumerProps) {
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
    const codeBuild = new codebuild.PipelineProject(this, "CodeBuild", {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
        computeType: codebuild.ComputeType.LARGE,
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec_test.yml"),
    });

    const dockerBuild = new codebuild.PipelineProject(this, "DockerBuild", {
      environmentVariables: {
        IMAGE_TAG: { value: "latest" },
        IMAGE_REPO_URI: { value: props.ecrRepository.repositoryUri },
        AWS_DEFAULT_REGION: { value: process.env.CDK_DEFAULT_REGION },
      },
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
        computeType: codebuild.ComputeType.LARGE,
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec_docker.yml"),
    });

    const dockerBuildRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ["*"],
      actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:GetRepositoryPolicy",
        "ecr:DescribeRepositories",
        "ecr:ListImages",
        "ecr:DescribeImages",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
      ],
    });

    dockerBuild.addToRolePolicy(dockerBuildRolePolicy);

    // Define los artefactos de salida
    const sourceOutput = new codepipeline.Artifact();
    const unitTestOutput = new codepipeline.Artifact();
    const dockerBuildOutput = new codepipeline.Artifact();

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

    pipeline.addStage({
      stageName: "Docker-Push-ECR",
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: "Docker-Build",
          project: dockerBuild,
          input: sourceOutput,
          outputs: [dockerBuildOutput],
        }),
      ],
    });

    pipeline.addStage({
      stageName: "Deploy-Test",
      actions: [
        new codepipeline_actions.EcsDeployAction({
          actionName: "Deploy-Fargate-Test",
          service: props.fargateServiceTest.service,
          input: dockerBuildOutput,
        }),
      ],
    });

    const ecsCodeDeployApp = new codedeploy.EcsApplication(this, "my-app", {
      applicationName: "my-app",
    });
    const prodEcsDeploymentGroup = new codedeploy.EcsDeploymentGroup(
      this,
      "my-app-dg",
      {
        service: props.fargateServiceProd.service,
        blueGreenDeploymentConfig: {
          blueTargetGroup: props.fargateServiceProd.targetGroup,
          greenTargetGroup: props.greenTargetGroup,
          listener: props.fargateServiceProd.listener,
          testListener: props.greenLoadBalancerListener,
        },
        deploymentConfig:
          codedeploy.EcsDeploymentConfig.LINEAR_10PERCENT_EVERY_1MINUTES,
        application: ecsCodeDeployApp,
      }
    );
    pipeline.addStage({
      stageName: "Deploy-Production",
      actions: [
        new codepipeline_actions.ManualApprovalAction({
          actionName: "Approve-Prod-Deploy",
          runOrder: 1,
        }),
        new codepipeline_actions.CodeDeployEcsDeployAction({
          actionName: "BlueGreen-deployECS",
          deploymentGroup: prodEcsDeploymentGroup,
          appSpecTemplateInput: sourceOutput,
          taskDefinitionTemplateInput: sourceOutput,
          runOrder: 2,
        }),
      ],
    });

    // Salida de la URL del repositorio
    new CfnOutput(this, "RepositoryUrl", {
      value: "https://github.com/devops-v7/tarea3-lab4-continuous-delivery",
    });
  }
}
